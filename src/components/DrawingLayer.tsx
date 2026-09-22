"use client";
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { Rendition } from 'epubjs';
import { HIGHLIGHT_COLORS } from '@/lib/highlights';
import { pathFor, type Drawing, type DrawingInput, type Point, type Stroke } from '@/lib/drawings';
import { anchorNearStrokes, captureDrawingPage, drawingAnchor } from '@/lib/drawing-page';

type Props = { reader: Rendition | null; viewer: HTMLElement | null; drawings: Drawing[]; seat: 1 | 2; color: number;
  hidden: boolean; active: boolean; takenOver: boolean; onCancel: () => void; onModalChange: (open: boolean) => void; onSave: (input: DrawingInput) => Promise<void>; onRemove: (id: string) => Promise<void> };
export default function DrawingLayer({ reader, viewer, drawings, seat, color, hidden, active, takenOver, onCancel, onModalChange, onSave, onRemove }: Props) {
  const [page, setPage] = useState<ReturnType<typeof captureDrawingPage> | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [current, setCurrent] = useState<Stroke | null>(null);
  const [width, setWidth] = useState(3);
  const [shown, setShown] = useState<Drawing | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const pointer = useRef<number | null>(null);
  const activeStroke = useRef<Stroke | null>(null);
  const draftId = useRef<string | null>(null);
  const overlay = useRef<SVGSVGElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  useEffect(() => {
    if (!viewer || !reader) return;
    const update = () => { setSize({ width: viewer.clientWidth, height: viewer.clientHeight }); setRevision(n => n + 1); };
    const resize = new ResizeObserver(update); resize.observe(viewer);
    reader.on('rendered', update); reader.on('relocated', update); update();
    return () => { resize.disconnect(); reader.off('rendered', update); reader.off('relocated', update); };
  }, [reader, viewer]);
  useEffect(() => {
    if (!active) { pointer.current = null; activeStroke.current = null; draftId.current = null; setPage(null); setStrokes([]); setCurrent(null); return; }
    if (!reader || !viewer) return;
    try { setPage(captureDrawingPage(reader, viewer)); draftId.current = crypto.randomUUID(); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not capture this page.'); onCancel(); }
  }, [active, reader, viewer, onCancel]);
  useEffect(() => { if (takenOver && active) onCancel(); }, [takenOver, active, onCancel]);
  const resized = !!(active && page && (Math.abs(size.width - page.page.width) > 1 || Math.abs(size.height - page.page.height) > 1));
  useEffect(() => { onModalChange(!!shown); if (shown) dialog.current?.showModal(); else dialog.current?.close(); }, [shown, onModalChange]);
  useEffect(() => { if (!active || !reader) return; const cancel = () => { pointer.current = null; activeStroke.current = null; setCurrent(null); }; reader.on('rendered', cancel); return () => reader.off('rendered', cancel); }, [active, reader]);
  const point = (event: PointerEvent<SVGSVGElement>): Point => {
    const box = overlay.current!.getBoundingClientRect();
    return [Math.max(0, Math.min(box.width, event.clientX - box.left)), Math.max(0, Math.min(box.height, event.clientY - box.top))];
  };
  const down = (event: PointerEvent<SVGSVGElement>) => {
    if (!active || saving || !page || resized) return;
    if (pointer.current !== null && event.pointerId !== pointer.current) { pointer.current = null; activeStroke.current = null; setCurrent(null); return; }
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault(); overlay.current?.setPointerCapture(event.pointerId); pointer.current = event.pointerId;
    activeStroke.current = { width, points: [point(event)] }; setCurrent(activeStroke.current);
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    if (pointer.current !== event.pointerId || !activeStroke.current) return;
    event.preventDefault();
    const next = point(event); const previous = activeStroke.current.points.at(-1)!;
    if (Math.hypot(next[0] - previous[0], next[1] - previous[1]) < 1) return;
    if (activeStroke.current.points.length >= 1000 || strokes.reduce((n, stroke) => n + stroke.points.length, 0) + activeStroke.current.points.length >= 3000) return;
    activeStroke.current = { ...activeStroke.current, points: [...activeStroke.current.points, next] }; setCurrent(activeStroke.current);
  };
  const finish = (event: PointerEvent<SVGSVGElement>, canceled: boolean) => {
    if (pointer.current !== event.pointerId) return;
    const completed = activeStroke.current;
    if (!canceled && completed && strokes.length < 80) setStrokes(all => [...all, completed]);
    pointer.current = null; activeStroke.current = null; setCurrent(null);
  };
  const save = async () => {
    if (!page || !strokes.length || saving || resized) return;
    setSaving(true); setError('');
    try { const location = anchorNearStrokes(page, strokes); await onSave({ id: draftId.current ?? crypto.randomUUID(), ...location, page: page.page, strokes }); onCancel(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save drawing.'); }
    finally { setSaving(false); }
  };
  const erase = async (drawing: Drawing) => {
    setSaving(true); setError('');
    try { await onRemove(drawing.id); setShown(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not remove drawing.'); }
    finally { setSaving(false); }
  };
  const pigment = HIGHLIGHT_COLORS[color] ?? HIGHLIGHT_COLORS[seat === 1 ? 0 : 3];
  return <>
    {!active && !hidden && reader && viewer && <svg className="drawing-overlay" viewBox={`0 0 ${size.width} ${size.height}`} aria-label="Saved drawings" key={revision}>
      {drawings.map(drawing => {
        const anchor = drawingAnchor(reader, viewer, drawing.cfi);
        if (!anchor) return null;
        const scale = Math.min(size.width / drawing.page.width, size.height / drawing.page.height);
        const x = anchor[0] - drawing.anchor[0] * scale, y = anchor[1] - drawing.anchor[1] * scale;
        return <g key={drawing.id} transform={`translate(${x} ${y}) scale(${scale})`} role="button" tabIndex={0} aria-label={`${drawing.seat === seat ? 'Your' : 'Partner’s'} drawing. View original page`} onClick={() => setShown(drawing)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setShown(drawing); } }}>
          {drawing.strokes.map((stroke, i) => <g key={i}>
            <path d={pathFor(stroke)} fill="none" stroke={drawing.color} strokeWidth={stroke.width} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />
            <path d={pathFor(stroke)} fill="none" stroke={drawing.color} strokeOpacity="0.001" strokeWidth="14" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" className="saved-drawing-stroke" />
          </g>)}
        </g>;
      })}
    </svg>}
    {active && <>
      <svg ref={overlay} className="drawing-canvas" viewBox={`0 0 ${page?.page.width ?? size.width} ${page?.page.height ?? size.height}`} preserveAspectRatio="none" aria-label="Draw on page" onPointerDown={down} onPointerMove={move} onPointerUp={event => finish(event, false)} onPointerCancel={event => finish(event, true)} onLostPointerCapture={event => finish(event, true)}>
        {[...strokes, ...(current ? [current] : [])].map((stroke, i) => <path key={i} d={pathFor(stroke)} fill="none" stroke={pigment} strokeWidth={stroke.width} strokeLinecap="round" strokeLinejoin="round" />)}
      </svg>
      {resized && <p className="error drawing-error" role="alert">The page size changed. Cancel and start again to keep the drawing aligned.</p>}
      <div className="drawing-tools" role="toolbar" aria-label="Drawing tools">
        <label>Pen <select value={width} onChange={event => setWidth(Number(event.target.value))} aria-label="Pen width"><option value="2">Thin</option><option value="3">Medium</option><option value="6">Thick</option></select></label>
        <button className="secondary" disabled={!strokes.length || saving} onClick={() => setStrokes(all => all.slice(0, -1))}>Undo</button>
        <button className="secondary" disabled={!strokes.length || saving} onClick={() => setStrokes([])}>Clear</button>
        <button className="secondary" disabled={saving} onClick={onCancel}>Cancel</button>
        <button disabled={!strokes.length || saving || resized} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </>}
    {error && <p className="error drawing-error" role="alert">{error}</p>}
    <dialog ref={dialog} className="drawing-dialog" onClose={() => setShown(null)} aria-label="Original drawing page">
      {shown && <><div className="drawing-dialog-head"><h2>Original page</h2><button className="secondary" onClick={() => setShown(null)} aria-label="Close original page">×</button></div>
        <p className="muted">{shown.seat === seat ? 'Your drawing.' : 'Partner’s drawing.'} Text and strokes as captured when this drawing was saved.</p>
        <div className="drawing-original-viewport"><div className="drawing-original" style={{ width: shown.page.width, height: shown.page.height }}>
          <svg viewBox={`0 0 ${shown.page.width} ${shown.page.height}`} aria-hidden="true">
            {shown.page.runs.map((run, i) => <text key={i} x={run.x} y={run.y} textLength={run.width} lengthAdjust="spacingAndGlyphs" dominantBaseline="text-before-edge" fontFamily={run.family} fontSize={run.size} fontWeight={run.weight} fontStyle={run.style} fill={run.color}>{run.text}</text>)}
            {shown.strokes.map((stroke, i) => <path key={i} d={pathFor(stroke)} fill="none" stroke={shown.color} strokeWidth={stroke.width} strokeLinecap="round" strokeLinejoin="round" />)}
          </svg>
        </div></div>
        {shown.seat === seat && !takenOver && <button className="secondary drawing-delete" disabled={saving} onClick={() => void erase(shown)}>Delete my drawing</button>}
      </>}
    </dialog>
  </>;
}
