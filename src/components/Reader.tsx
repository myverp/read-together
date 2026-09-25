"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import ePub, { type Book, type Rendition, type Location, type Contents } from "epubjs";
import { useRoom } from "@/lib/use-room";
import type { Room } from "@/lib/types";
import { useHighlights } from "@/lib/use-highlights";
import { HIGHLIGHT_COLORS, type HighlightSnapshot } from "@/lib/highlights";
import HighlightDialog, { type Selection, type HighlightDialogState } from "./HighlightDialog";
import PageAudio, { type AudioVoice, type PageAudioController } from "./PageAudio";
import { visiblePageText } from "@/lib/page-text";
import { api } from "@/lib/client";
import { useDrawings } from "@/lib/use-drawings";
import DrawingLayer from "./DrawingLayer";
import { attachReaderSwipes } from "@/lib/reader-swipes";

export default function Reader({ room, onExit }: { room: Room; onExit: () => void }) {
  const { highlights, colors, error: highlightError, refresh, save, remove } = useHighlights(room.code);
  const { drawings, error: drawingError, refresh: refreshDrawings, save: saveDrawing, remove: removeDrawing } = useDrawings(room.code);
  const refreshAnnotations = useCallback(() => { void refresh(); void refreshDrawings(); }, [refresh, refreshDrawings]);
  const { me, partner, online, connection, storageError, update, notifyHighlights, takenOver, flushProgress } = useRoom(room, refreshAnnotations);
  const viewer = useRef<HTMLDivElement>(null);
  const rendition = useRef<Rendition | null>(null);
  const current = useRef(me);
  const publish = useRef(update);
  const [loading, setLoading] = useState(true);
  const [turning, setTurning] = useState(false);
  const navigationBusy = useRef(false);
  const [error, setError] = useState("");
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(true);
  const [audioPage, setAudioPage] = useState<{ text: string; id: string } | null>(null);
  const [audioKey, setAudioKey] = useState("");
  const [audioVoice, setAudioVoice] = useState<AudioVoice | null>(null);
  const [currentColor, setCurrentColor] = useState(room.color ?? -1);
  const partnerColor = colors?.[room.seat === 1 ? 1 : 0] ?? room.partnerColor ?? -1;
  const audioOpen = useRef(false);
  const audioController = useRef<PageAudioController | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [highlightDialog, setHighlightDialog] = useState<HighlightDialogState | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [startingDrawing, setStartingDrawing] = useState(false);
  const [drawingModal, setDrawingModal] = useState(false);
  const cancelDrawing = useCallback(() => setDrawing(false), []);
  const changeDrawingModal = useCallback((open: boolean) => { setDrawingModal(open); if (open) audioController.current?.pause(); }, []);
  const [drawingsHidden, setDrawingsHidden] = useState(false);
  const drawingRef = useRef(false); drawingRef.current = drawing;
  const shownDialog = useRef(highlightDialog);
  const controlLost = useRef(takenOver); controlLost.current = takenOver;
  shownDialog.current = highlightDialog;
  const swipeState = useRef({ loading, selection, highlightDialog, atStart, atEnd, drawing, drawingModal });
  swipeState.current = { loading, selection, highlightDialog, atStart, atEnd, drawing, drawingModal };
  const swipeNavigate = useRef(navigate);
  swipeNavigate.current = navigate;
  current.current = me;
  publish.current = update;
  const setAudioController = useCallback((controller: PageAudioController | null) => { audioController.current = controller; }, []);

  useEffect(() => () => { audioController.current?.stop(); }, []);
  useEffect(() => {
    if (!takenOver) return;
    audioController.current?.stop(); audioOpen.current = false; setAudioPage(null); setSelection(null); setHighlightDialog(null); setDrawing(false);
  }, [takenOver]);
  useEffect(() => { if (selection) audioController.current?.stop(); }, [selection]);
  useEffect(() => { if (highlightDialog) audioController.current?.pause(); }, [highlightDialog]);

  useEffect(() => {
    if (!viewer.current) return;
    const element = viewer.current;
    let disposed = false;
    let book: Book | undefined;
    let resize: ResizeObserver | undefined;
    let selectionTimer: ReturnType<typeof setInterval> | undefined;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      abort.abort();
      if (!disposed) { setError("Opening the EPUB timed out. Exit and reopen the room to retry."); setLoading(false); }
    }, 45000);
    async function open() {
      try {
        const response = await fetch(room.bookUrl, { signal: abort.signal });
        if (!response.ok) throw new Error("Could not download the EPUB. Exit and reopen the room to retry.");
        const bytes = await response.arrayBuffer();
        if (disposed) return;
        book = ePub();
        await book.open(bytes, "binary");
        await Promise.all([book.opened, book.ready]);
        if (disposed) return;
        // WebKit blocks parent-installed event listeners when sandbox scripts are
        // disabled. Install CSP in the inert section document before serialization.
        book.spine.hooks.content.register((doc: Document) => {
          const root = doc.documentElement;
          const head = Array.from(root.children).find(node => node.localName === "head");
          const body = Array.from(root.children).find(node => node.localName === "body");
          if (root.localName !== "html" || !head || !body) throw new Error("Unsupported EPUB section structure.");
          Array.from(root.childNodes).forEach(node => { if (node !== head && node !== body) node.remove(); });
          root.insertBefore(head, root.firstChild);
          // Prevent document replacement from dropping the policy.
          doc.querySelectorAll('meta[http-equiv]').forEach(meta => meta.remove());
          const policy = doc.createElementNS(root.namespaceURI, "meta");
          policy.setAttribute("http-equiv", "Content-Security-Policy");
          policy.setAttribute("content", "script-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'");
          head.insertBefore(policy, head.firstChild);
        });
        const reader = book.renderTo(element, {
          width: element.clientWidth, height: element.clientHeight,
          flow: "paginated", spread: "none", manager: "default",
          allowScriptedContent: true,
        });
        rendition.current = reader;
        const captureSelection = (cfi: string, contents: Contents) => {
          if (disposed || controlLost.current || shownDialog.current || audioOpen.current || drawingRef.current) return;
          const quote = contents.window.getSelection()?.toString().trim();
          if (!quote) return;
          if (quote.length > 3000) { setError("Select a shorter passage (up to 3,000 characters)."); setSelection(null); return; }
          setError("");
          setSelection(previous => previous?.cfi === cfi && previous.quote === quote ? previous : { id: crypto.randomUUID(), cfi, quote });
        };
        reader.on("selected", captureSelection);
        reader.themes.default({ body: { "font-family": "Georgia, serif", "font-size": "18px", "line-height": "1.6" },
          "img, svg": { "max-width": "100%", "max-height": "100%" } });
        reader.on("relocated", (location: Location) => {
          if (disposed || controlLost.current) return;
          setAtStart(location.atStart); setAtEnd(location.atEnd);
          const label = book?.navigation.get(location.start.href)?.label?.trim();
          const next = {
            cfi: location.start.cfi,
            section: `p. ${location.start.displayed.page} · ${label || `Section ${location.start.index + 1}`}`.slice(0, 300),
            done: location.start.cfi === current.current.cfi ? current.current.done : false,
          };
          // Reflow can emit the same location repeatedly; do not resend unchanged Presence.
          if (next.cfi === current.current.cfi && next.section === current.current.section && next.done === current.current.done) return;
          current.current = next;
          publish.current(next);
        });
        reader.on("displayError", () => { if (!disposed) setError("This section could not be displayed. Try reopening the room with a DRM-free EPUB."); });
        await reader.display(current.current.cfi || undefined);
        if (disposed) return;
        // Explicit dimensions prevent the iframe from expanding the mobile viewport.
        resize = new ResizeObserver(() => {
          if (!disposed && !audioOpen.current && element.clientWidth && element.clientHeight) reader.resize(element.clientWidth, element.clientHeight);
        });
        resize.observe(element);
        // WebKit can omit selectionchange callbacks inside sandboxed EPUB frames.
        // Read from the trusted parent instead; never enable scripts in the book.
        selectionTimer = setInterval(() => {
          if (disposed || shownDialog.current || audioOpen.current || drawingRef.current || document.visibilityState !== "visible") return;
          const contents = reader.getContents() as unknown as Contents[];
          let hasSelection = false;
          for (const content of contents) {
            const selected = content.window.getSelection();
            if (!selected?.rangeCount || selected.isCollapsed) continue;
            hasSelection = true;
            try { captureSelection(content.cfiFromRange(selected.getRangeAt(0)), content); }
            catch { /* The view may have unloaded during a page turn. */ }
          }
          if (!hasSelection) setSelection(previous => previous ? null : previous);
        }, 400);
        setLoading(false);
      } catch (e) {
        if (!disposed) {
          setError(e instanceof Error ? e.message : "Could not open this EPUB. Use a DRM-free EPUB.");
          setLoading(false);
        }
      } finally { clearTimeout(timer); }
    }
    void open();
    return () => {
      disposed = true; abort.abort(); clearTimeout(timer); clearInterval(selectionTimer); resize?.disconnect();
      rendition.current = null; book?.destroy();
    };
  }, [room.bookUrl]);

  useEffect(() => {
    const reader = rendition.current;
    if (!reader || loading) return;
    // epub.js keys annotations by CFI: identical selections share one clickable overlay.
    const groups = new Map(highlights.map(mark => [mark.cfi, mark]));
    const openMark = (cfi: string) => { audioController.current?.pause(); setSelection(null); setHighlightDialog({ cfi }); };
    groups.forEach(mark => {
      try {
        reader.annotations.highlight(mark.cfi, { id: mark.id }, () => openMark(mark.cfi), "shared-highlight", {
          fill: HIGHLIGHT_COLORS[mark.color], "fill-opacity": "0.32", "mix-blend-mode": "multiply",
        });
      } catch { /* A malformed location must not prevent the rest of the book from opening. */ }
    });
    const accessibleMarks = () => {
      viewer.current?.querySelectorAll<SVGElement>(".shared-highlight").forEach(element => {
        const mark = highlights.find(h => h.id === element.dataset.id);
        if (!mark) return;
        element.setAttribute("tabindex", "0");
        element.setAttribute("role", "button");
        element.setAttribute("aria-label", `${mark.seat === room.seat ? "Your" : "Partner’s"} highlight: ${mark.quote.slice(0, 80)}${mark.comment ? ". Has comment" : ""}`);
        element.onkeydown = event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openMark(mark.cfi); } };
      });
    };
    accessibleMarks();
    reader.on("rendered", accessibleMarks);
    return () => {
      reader.off("rendered", accessibleMarks);
      if (rendition.current === reader) groups.forEach(mark => reader.annotations.remove(mark.cfi, "highlight"));
    };
  }, [highlights, loading, room.seat]);

  useEffect(() => {
    const reader = rendition.current;
    const element = viewer.current;
    if (!reader || !element || loading) return;
    return attachReaderSwipes(reader, element, {
      isBlocked: content => {
        const state = swipeState.current;
        const selected = content.window.getSelection();
        return state.loading || state.drawing || state.drawingModal || audioOpen.current || navigationBusy.current || !!state.selection || !!state.highlightDialog ||
          !!(selected && !selected.isCollapsed);
      },
      canTurn: direction => direction === "next" ? !swipeState.current.atEnd : !swipeState.current.atStart,
      navigate: direction => { void swipeNavigate.current(direction); },
    });
  }, [loading, room.bookUrl]);

  function clearSelection() {
    // epub.js returns an array at runtime; its bundled getContents typing is incorrect.
    const contents = rendition.current?.getContents() as unknown as Contents[] | undefined;
    contents?.forEach(content => content.window.getSelection()?.removeAllRanges());
    setSelection(null);
  }

  async function navigate(target: "prev" | "next" | string, continuing = false) {
    const reader = rendition.current;
    if (!reader || navigationBusy.current || controlLost.current || drawingRef.current || drawingModal) return;
    if (!continuing) audioController.current?.stop();
    navigationBusy.current = true;
    clearSelection();
    setTurning(true); setError("");
    try {
      if (target === "prev") await reader.prev();
      else if (target === "next") await reader.next();
      else await reader.display(target);
      if (audioPage && !continuing) setAudioPage(visiblePageText(reader));
    } catch { setError("Could not turn to that position. Try reopening the room."); }
    finally { navigationBusy.current = false; setTurning(false); }
  }

  function openAudio() {
    if (!rendition.current || navigationBusy.current || controlLost.current || drawingRef.current) return;
    try {
      const page = visiblePageText(rendition.current);
      clearSelection(); setError(""); audioOpen.current = true; setAudioPage(page);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not read this page’s text."); }
  }

  function closeAudio() {
    audioOpen.current = false; setAudioPage(null);
    // Restore layout after the settings keyboard or a device rotation.
    const element = viewer.current;
    if (element) rendition.current?.resize(element.clientWidth, element.clientHeight);
  }

  async function nextAudioPage() {
    const currentReader = rendition.current;
    if (!currentReader || (currentReader.currentLocation() as unknown as Location | null)?.atEnd) return null;
    await navigate("next", true);
    const reader = rendition.current;
    if (!reader) return null;
    const page = visiblePageText(reader);
    setAudioPage(page);
    return page.text;
  }

  async function exitReader() {
    audioController.current?.stop();
    await flushProgress();
    onExit();
  }

  async function changeColor(color: number) {
    if (takenOver || color === currentColor) return;
    try { await api(`/api/rooms/${room.code}/color`, { color }, "PATCH"); setCurrentColor(color); await refresh(); notifyHighlights(); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not change highlight color."); }
  }

  async function startDrawing() {
    if (!rendition.current || loading || turning || takenOver || highlightDialog || startingDrawing) return;
    setStartingDrawing(true);
    try {
      if (currentColor < 0) {
        const latest = await api<HighlightSnapshot>(`/api/rooms/${room.code}/highlights`, undefined, "GET");
        const other = latest.colors?.[room.seat === 1 ? 1 : 0] ?? -1;
        const preferred = room.seat === 1 ? 0 : 3;
        const chosen = [preferred, ...HIGHLIGHT_COLORS.map((_, index) => index)].find(index => index !== other)!;
        await api(`/api/rooms/${room.code}/color`, { color: chosen }, "PATCH");
        setCurrentColor(chosen); await refresh(); notifyHighlights();
      }
      audioController.current?.stop(); audioOpen.current = false; setAudioPage(null); clearSelection(); setError(""); setDrawing(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not start drawing."); }
    finally { setStartingDrawing(false); }
  }

  return <main className="reader">
    <div id="reader-details" hidden={!detailsExpanded}>
    <section className="reader-status" aria-label="Reader positions">
      <div><strong>You</strong><span>{me.section}</span><span className={me.done ? "done" : "muted"}>{me.done ? "Done here" : "Reading"}</span></div>
      <div><strong>Partner <small>{online ? "· online" : "· offline"}</small></strong>
        <span>{partner.cfi ? partner.section : "Waiting for partner"}</span>
        <span className={partner.done ? "done" : "muted"}>{partner.cfi ? `${partner.done ? "Done here" : "Reading"}${online ? "" : " · last seen"}` : "Share the room code"}</span>
      </div>
      <button className="secondary room-exit" onClick={() => void exitReader()} aria-label="Exit" title="Exit room"><Image src="/icons/open-door.png" alt="" width={24} height={24} unoptimized /></button>
    </section>
    <p className="connection" role="status">{connection}</p>
    <div className="room-colors" aria-label="Your room highlight color">{HIGHLIGHT_COLORS.map((color, index) => <button key={color} disabled={takenOver || index === partnerColor} className={currentColor === index ? "color-choice selected" : "color-choice"} style={{ backgroundColor: color }} aria-label={index === partnerColor ? `Color ${index + 1} is used by your partner` : `Use color ${index + 1} in this room`} aria-pressed={currentColor === index} title={index === partnerColor ? "Used by your partner" : undefined} onClick={() => void changeColor(index)} />)}</div>
    </div>
    <div className="reader-toolbar">
      <button className="secondary partner-jump" disabled={takenOver || drawing || drawingModal || !partner.cfi || loading || turning} onClick={() => navigate(partner.cfi)} aria-label="Jump to partner"><span>Jump to partner</span><span className="partner-jump-short">Partner</span></button>
      <button className="secondary details-toggle" disabled={takenOver || loading || turning || startingDrawing || drawing || drawingModal || !!highlightDialog} onClick={() => void startDrawing()} aria-label="Draw on page" title="Draw on page">
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m4 20 4.5-1 11-11a2.1 2.1 0 0 0-3-3l-11 11L4 20Z"/><path d="m14.5 6.5 3 3"/></svg>
      </button>
      <button className="secondary details-toggle" aria-pressed={drawingsHidden} onClick={() => setDrawingsHidden(value => !value)} aria-label={drawingsHidden ? "Show drawings" : "Hide drawings"} title={drawingsHidden ? "Show drawings" : "Hide drawings"}>
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>{drawingsHidden && <path d="M3 21 21 3" strokeWidth="2.5"/>}</svg>
      </button>
      <button className="secondary details-toggle" disabled={takenOver || loading || turning || drawing || drawingModal || !!highlightDialog} onClick={openAudio} aria-label="Listen to page" title="Listen to page">
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 14v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="12" width="4" height="8" rx="2"/><rect x="17" y="12" width="4" height="8" rx="2"/></svg>
      </button>
      <button className="secondary details-toggle" aria-expanded={detailsExpanded} aria-controls="reader-details" aria-label={detailsExpanded ? "Collapse room details" : "Expand room details"} onClick={() => setDetailsExpanded(expanded => !expanded)}>
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d={detailsExpanded ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} /></svg>
      </button>
    </div>
    {(error || storageError || highlightError || drawingError) && <p className="error reader-error" role="alert">{error || storageError || highlightError || drawingError}</p>}
    {takenOver && <div className="taken-over" role="alert"><strong>Continued on another device</strong><span>This reader is now view-only. Exit and choose Continue here to take control again.</span></div>}
    <div className="book-area"><div ref={viewer} className="book-view" aria-label="EPUB reader" />{loading && <p className="book-loading" role="status">Opening EPUB…</p>}
      {!loading && <DrawingLayer reader={rendition.current} viewer={viewer.current} drawings={drawings} seat={room.seat} hidden={drawingsHidden} active={drawing} takenOver={takenOver} onCancel={cancelDrawing} onModalChange={changeDrawingModal} onSave={async input => { await saveDrawing(input); notifyHighlights(); }} onRemove={async id => { await removeDrawing(id); notifyHighlights(); }} />}
      {selection && !takenOver && !drawing && <div className="selection-actions">
        <button onClick={() => { audioController.current?.pause(); setHighlightDialog({ draft: selection }); clearSelection(); }}>Highlight selection</button>
        <button className="secondary" onClick={clearSelection} aria-label="Dismiss selection">×</button>
      </div>}
    </div>
    {highlightDialog && !takenOver && <HighlightDialog state={highlightDialog} highlights={highlights} seat={room.seat}
      onClose={() => { setHighlightDialog(null); clearSelection(); }}
      onSave={async input => { await save(input); notifyHighlights(); }}
      onRemove={async id => { await remove(id); notifyHighlights(); }} />}
    {audioPage && <PageAudio code={room.code} text={audioPage.text} apiKey={audioKey} setApiKey={setAudioKey} preferredVoice={audioVoice} setPreferredVoice={setAudioVoice} onNextPage={nextAudioPage} onController={setAudioController} onClose={closeAudio} />}
    <footer className="reader-controls">
      <button className="secondary" disabled={takenOver || drawing || drawingModal || loading || turning || atStart} onClick={() => navigate("prev")} aria-label="Previous page">← Previous</button>
      <button aria-pressed={me.done} disabled={takenOver || drawing || drawingModal || loading || !me.cfi} onClick={() => update({ ...current.current, done: !current.current.done })}>{me.done ? "Keep reading" : "Done here"}</button>
      <button className="secondary" disabled={takenOver || drawing || drawingModal || loading || turning || atEnd} onClick={() => navigate("next")} aria-label="Next page">Next →</button>
    </footer>
  </main>;
}
