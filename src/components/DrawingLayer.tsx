"use client";
import { useEffect, useReducer, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import type { Rendition } from 'epubjs';
import { DRAWING_COLORS, pathFor, type Drawing, type DrawingInput, type Point, type Stroke } from '@/lib/drawings';
import { anchorNearStrokes, captureDrawingPage, drawingAnchor } from '@/lib/drawing-page';

type InkStroke = Stroke & { color: string };
type EditState = { strokes: InkStroke[]; past: InkStroke[][]; eraseGesture: number | null };
type EditAction = { type: 'add'; stroke: InkStroke } | { type: 'erase'; target: Point; radius: number; gesture: number } | { type: 'undo' } | { type: 'reset' };
const emptyEdit: EditState = { strokes: [], past: [], eraseGesture: null };
function touches(stroke: InkStroke, target: Point, radius: number) {
  return stroke.points.some((point, index) => {
    const previous = stroke.points[index - 1];
    if (!previous) return Math.hypot(target[0] - point[0], target[1] - point[1]) <= radius;
    const dx = point[0] - previous[0], dy = point[1] - previous[1];
    const t = Math.max(0, Math.min(1, ((target[0] - previous[0]) * dx + (target[1] - previous[1]) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(target[0] - (previous[0] + t * dx), target[1] - (previous[1] + t * dy)) <= radius;
  });
}
function editReducer(state: EditState, action: EditAction): EditState {
  if (action.type === 'reset') return emptyEdit;
  if (action.type === 'undo') return state.past.length ? { strokes: state.past.at(-1)!, past: state.past.slice(0, -1), eraseGesture: null } : state;
  const next = action.type === 'add'
    ? state.strokes.length < 80 && state.strokes.reduce((n, stroke) => n + stroke.points.length, 0) + action.stroke.points.length <= 3000
      ? [...state.strokes, action.stroke] : state.strokes
    : state.strokes.filter(stroke => !touches(stroke, action.target, action.radius));
  if (next.length === state.strokes.length) return state;
  const sameGesture = action.type === 'erase' && state.eraseGesture === action.gesture;
  return { strokes: next, past: sameGesture ? state.past : [...state.past.slice(-49), state.strokes], eraseGesture: action.type === 'erase' ? action.gesture : null };
}

type Props = { reader: Rendition | null; viewer: HTMLElement | null; drawings: Drawing[]; seat: 1 | 2;
  hidden: boolean; active: boolean; takenOver: boolean; onCancel: () => void; onModalChange: (open: boolean) => void; onSave: (input: DrawingInput) => Promise<void>; onRemove: (id: string) => Promise<void> };
export default function DrawingLayer({ reader, viewer, drawings, seat, hidden, active, takenOver, onCancel, onModalChange, onSave, onRemove }: Props) {
  const [page, setPage] = useState<ReturnType<typeof captureDrawingPage> | null>(null);
  const [edit, dispatch] = useReducer(editReducer, emptyEdit);
  const strokes = edit.strokes;
  const [current, setCurrent] = useState<InkStroke | null>(null);
  const [width, setWidth] = useState(3);
  const [erasing, setErasing] = useState(false);
  const [inkColor, setInkColor] = useState(6);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shown, setShown] = useState<Drawing | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const pointer = useRef<number | null>(null);
  const eraserGesture = useRef(0);
  const activeStroke = useRef<InkStroke | null>(null);
  const draftId = useRef<string | null>(null);
  const overlay = useRef<SVGSVGElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const colorPicker = useRef<HTMLDivElement>(null);
  const colorButton = useRef<HTMLButtonElement>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  useEffect(() => {
    if (!viewer || !reader) return;
    const update = () => { setSize({ width: viewer.clientWidth, height: viewer.clientHeight }); setRevision(n => n + 1); };
    const resize = new ResizeObserver(update); resize.observe(viewer);
    reader.on('rendered', update); reader.on('relocated', update); update();
    return () => { resize.disconnect(); reader.off('rendered', update); reader.off('relocated', update); };
  }, [reader, viewer]);
  useEffect(() => {
    if (!active) { pointer.current = null; activeStroke.current = null; draftId.current = null; setPage(null); dispatch({ type: 'reset' }); setCurrent(null); setErasing(false); setPaletteOpen(false); return; }
    if (!reader || !viewer) return;
    try { setPage(captureDrawingPage(reader, viewer)); draftId.current = crypto.randomUUID(); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not capture this page.'); onCancel(); }
  }, [active, reader, viewer, onCancel]);
  useEffect(() => {
    if (!paletteOpen) return;
    const dismissOutside = (event: globalThis.PointerEvent) => {
      if (!colorPicker.current?.contains(event.target as Node)) setPaletteOpen(false);
    };
    const dismissEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setPaletteOpen(false); colorButton.current?.focus(); }
    };
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('keydown', dismissEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('keydown', dismissEscape);
    };
  }, [paletteOpen]);
  useEffect(() => { if (takenOver && active) onCancel(); }, [takenOver, active, onCancel]);
  const resized = !!(active && page && (Math.abs(size.width - page.page.width) > 1 || Math.abs(size.height - page.page.height) > 1));
  useEffect(() => { onModalChange(!!shown); if (shown) dialog.current?.showModal(); else dialog.current?.close(); }, [shown, onModalChange]);
  useEffect(() => { if (!active || !reader) return; const cancel = () => { pointer.current = null; activeStroke.current = null; setCurrent(null); }; reader.on('rendered', cancel); return () => reader.off('rendered', cancel); }, [active, reader]);
  const point = (event: PointerEvent<SVGSVGElement>): Point => {
    const box = overlay.current!.getBoundingClientRect();
    return [Math.max(0, Math.min(box.width, event.clientX - box.left)), Math.max(0, Math.min(box.height, event.clientY - box.top))];
  };
  const eraseAt = (target: Point) => {
    dispatch({ type: 'erase', target, radius: Math.max(10, width * 1.5), gesture: eraserGesture.current });
  };
  const down = (event: PointerEvent<SVGSVGElement>) => {
    if (!active || saving || !page || resized) return;
    if (pointer.current !== null && event.pointerId !== pointer.current) { pointer.current = null; activeStroke.current = null; setCurrent(null); return; }
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault(); overlay.current?.setPointerCapture(event.pointerId); pointer.current = event.pointerId;
    if (erasing) { eraserGesture.current += 1; eraseAt(point(event)); return; }
    activeStroke.current = { width, color: DRAWING_COLORS[inkColor], points: [point(event)] }; setCurrent(activeStroke.current);
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    if (pointer.current !== event.pointerId) return;
    event.preventDefault();
    const next = point(event);
    if (erasing) { eraseAt(next); return; }
    if (!activeStroke.current) return;
    const previous = activeStroke.current.points.at(-1)!;
    if (Math.hypot(next[0] - previous[0], next[1] - previous[1]) < 1) return;
    if (activeStroke.current.points.length >= 1000 || strokes.reduce((n, stroke) => n + stroke.points.length, 0) + activeStroke.current.points.length >= 3000) return;
    activeStroke.current = { ...activeStroke.current, points: [...activeStroke.current.points, next] }; setCurrent(activeStroke.current);
  };
  const finish = (event: PointerEvent<SVGSVGElement>, canceled: boolean) => {
    if (pointer.current !== event.pointerId) return;
    const completed = activeStroke.current;
    if (!canceled && completed) dispatch({ type: 'add', stroke: completed });
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
  const pigment = DRAWING_COLORS[inkColor];
  return <>
    {!active && !hidden && reader && viewer && <svg className="drawing-overlay" viewBox={`0 0 ${size.width} ${size.height}`} aria-label="Saved drawings" key={revision}>
      {drawings.map(drawing => {
        const anchor = drawingAnchor(reader, viewer, drawing.cfi);
        if (!anchor) return null;
        const scale = Math.min(size.width / drawing.page.width, size.height / drawing.page.height);
        const x = anchor[0] - drawing.anchor[0] * scale, y = anchor[1] - drawing.anchor[1] * scale;
        return <g key={drawing.id} transform={`translate(${x} ${y}) scale(${scale})`} role="button" tabIndex={0} aria-label={`${drawing.seat === seat ? 'Your' : 'Partner’s'} drawing. View original page`} onClick={() => setShown(drawing)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setShown(drawing); } }}>
          {drawing.strokes.map((stroke, i) => <g key={i}>
            <path d={pathFor(stroke)} fill="none" stroke={stroke.color ?? drawing.color} strokeWidth={stroke.width} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />
            <path d={pathFor(stroke)} fill="none" stroke={drawing.color} strokeOpacity="0.001" strokeWidth="14" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" className="saved-drawing-stroke" />
          </g>)}
        </g>;
      })}
    </svg>}
    {active && <>
      <svg ref={overlay} className={`drawing-canvas${erasing ? ' is-erasing' : ''}`} viewBox={`0 0 ${page?.page.width ?? size.width} ${page?.page.height ?? size.height}`} preserveAspectRatio="none" aria-label={erasing ? 'Erase strokes on page' : 'Draw on page'} onPointerDown={down} onPointerMove={move} onPointerUp={event => finish(event, false)} onPointerCancel={event => finish(event, true)} onLostPointerCapture={event => finish(event, true)}>
        {[...strokes, ...(current ? [current] : [])].map((stroke, i) => <path key={i} d={pathFor(stroke)} fill="none" stroke={stroke.color} strokeWidth={stroke.width} strokeLinecap="round" strokeLinejoin="round" />)}
      </svg>
      {resized && <p className="error drawing-error" role="alert">The page size changed. Cancel and start again to keep the drawing aligned.</p>}
      <div className="drawing-tools" role="toolbar" aria-label="Drawing tools">
        <div className="drawing-appearance">
          <div className="drawing-color-picker" ref={colorPicker}>
            <button ref={colorButton} type="button" className="secondary drawing-color-current" aria-label="Choose ink color" aria-expanded={paletteOpen} title={`Ink color ${pigment}`} onClick={() => setPaletteOpen(open => !open)}>
              <span className="drawing-current-swatch" style={{ '--swatch-color': pigment } as CSSProperties & { '--swatch-color': string }} />
            </button>
            {paletteOpen && <div className="drawing-palette" role="group" aria-label="Choose ink color">
              {DRAWING_COLORS.map((swatch, index) => <button key={swatch} type="button" aria-label={`Ink color ${swatch}`} aria-pressed={inkColor === index} title={`Ink color ${swatch}`} className={`drawing-swatch${inkColor === index ? ' is-selected' : ''}`} style={{ '--swatch-color': swatch } as CSSProperties & { '--swatch-color': string }} onClick={() => { setInkColor(index); setErasing(false); setPaletteOpen(false); colorButton.current?.focus(); }} />)}
            </div>}
          </div>
          <label className="drawing-size">
            <span className="drawing-size-label">Ink width <output htmlFor="drawing-width">{width}px</output></span>
            <span className="drawing-size-control"><span className="drawing-size-preview" style={{ height: Math.min(width, 16), backgroundColor: pigment }} aria-hidden="true" /><input id="drawing-width" type="range" min="1" max="16" step="1" value={width} onChange={event => setWidth(Number(event.target.value))} aria-label="Ink width" /></span>
          </label>
        </div>
        <div className="drawing-actions">
          <button className="secondary drawing-icon-button" disabled={!edit.past.length || saving} onClick={() => dispatch({ type: 'undo' })} aria-label="Undo" title="Undo last change">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M9 7 4 12l5 5M4 12h10a6 6 0 0 1 6 6" /></svg>
          </button>
          <button className={`secondary drawing-icon-button${erasing ? ' is-selected' : ''}`} disabled={saving} onClick={() => setErasing(value => !value)} aria-label="Eraser" aria-pressed={erasing} title={erasing ? 'Eraser on · tap to use pen' : 'Eraser off · tap to erase strokes'}>
            <svg aria-hidden="true" viewBox="0 0 24 24"><g transform="rotate(45 12 12)"><rect x="7" y="3" width="10" height="18" rx="2.3" /><path d="M7 12h10" /></g></svg>
          </button>
          <button className="secondary drawing-icon-button" disabled={saving} onClick={onCancel} aria-label="Cancel" title="Cancel drawing">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
          <button className="drawing-icon-button" disabled={!strokes.length || saving || resized} onClick={() => void save()} aria-label="Save" title={saving ? 'Saving drawing' : 'Save drawing'}>
            {saving ? <span className="drawing-saving-dot" aria-hidden="true" /> : <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 4h12l3 3v13H4V4h1ZM8 4v6h8V4M8 20v-7h8v7" /></svg>}
          </button>
        </div>
      </div>
    </>}
    {error && <p className="error drawing-error" role="alert">{error}</p>}
    <dialog ref={dialog} className="drawing-dialog" onClose={() => setShown(null)} aria-label="Original drawing page">
      {shown && <><div className="drawing-dialog-head"><h2>Original page</h2><button className="secondary" onClick={() => setShown(null)} aria-label="Close original page">×</button></div>
        <p className="muted">{shown.seat === seat ? 'Your drawing.' : 'Partner’s drawing.'} Text and strokes as captured when this drawing was saved.</p>
        <div className="drawing-original-viewport"><div className="drawing-original" style={{ width: shown.page.width, height: shown.page.height }}>
          <svg viewBox={`0 0 ${shown.page.width} ${shown.page.height}`} aria-hidden="true">
            {shown.page.runs.map((run, i) => <text key={i} x={run.x} y={run.y} textLength={run.width} lengthAdjust="spacingAndGlyphs" dominantBaseline="text-before-edge" fontFamily={run.family} fontSize={run.size} fontWeight={run.weight} fontStyle={run.style} fill={run.color}>{run.text}</text>)}
            {shown.strokes.map((stroke, i) => <path key={i} d={pathFor(stroke)} fill="none" stroke={stroke.color ?? shown.color} strokeWidth={stroke.width} strokeLinecap="round" strokeLinejoin="round" />)}
          </svg>
        </div></div>
        {shown.seat === seat && !takenOver && <button className="secondary drawing-delete" disabled={saving} onClick={() => void erase(shown)}>Delete my drawing</button>}
      </>}
    </dialog>
  </>;
}
