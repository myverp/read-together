"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import ePub, { type Book, type Rendition, type Location, type Contents } from "epubjs";
import { useRoom } from "@/lib/use-room";
import type { Room } from "@/lib/types";
import { useHighlights } from "@/lib/use-highlights";
import { HIGHLIGHT_COLORS } from "@/lib/highlights";
import HighlightDialog, { type Selection, type HighlightDialogState } from "./HighlightDialog";
import PageAudio, { type AudioVoice } from "./PageAudio";
import { visiblePageText } from "@/lib/page-text";

export default function Reader({ room, onExit }: { room: Room; onExit: () => void }) {
  const { highlights, error: highlightError, refresh, save, remove } = useHighlights(room.code);
  const { me, partner, online, connection, storageError, update, notifyHighlights } = useRoom(room, refresh);
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
  const audioOpen = useRef(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [highlightDialog, setHighlightDialog] = useState<HighlightDialogState | null>(null);
  const shownDialog = useRef(highlightDialog);
  shownDialog.current = highlightDialog;
  const swipeState = useRef({ loading, selection, highlightDialog, atStart, atEnd });
  swipeState.current = { loading, selection, highlightDialog, atStart, atEnd };
  const swipeNavigate = useRef(navigate);
  swipeNavigate.current = navigate;
  current.current = me;
  publish.current = update;

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
          if (disposed || shownDialog.current || audioOpen.current) return;
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
          if (disposed) return;
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
          if (disposed || shownDialog.current || audioOpen.current || document.visibilityState !== "visible") return;
          const contents = reader.getContents() as unknown as Contents[];
          for (const content of contents) {
            const selected = content.window.getSelection();
            if (!selected?.rangeCount || selected.isCollapsed) continue;
            try { captureSelection(content.cfiFromRange(selected.getRangeAt(0)), content); }
            catch { /* The view may have unloaded during a page turn. */ }
          }
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
    const openMark = (cfi: string) => { setSelection(null); setHighlightDialog({ cfi }); };
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
    if (!reader || loading) return;
    const attached = new Map<Document, () => void>();
    const attach = () => {
      const contents = reader.getContents() as unknown as Contents[];
      const active = new Set(contents.map(content => content.document));
      attached.forEach((cleanup, doc) => {
        if (!active.has(doc)) { cleanup(); attached.delete(doc); }
      });
      for (const content of contents) {
        const doc = content.document;
        if (attached.has(doc)) continue;
        let gesture: { id: number; x: number; y: number; started: number } | null = null;
        const cancel = () => { gesture = null; };
        const blocked = () => {
          const state = swipeState.current;
          const selected = content.window.getSelection();
          return state.loading || audioOpen.current || navigationBusy.current || !!state.selection || !!state.highlightDialog ||
            !!(selected && !selected.isCollapsed);
        };
        // Annotations are SVG overlays in the parent, not children of the iframe.
        const onHighlight = (touch: Touch) => {
          const frame = content.window.frameElement?.getBoundingClientRect();
          if (!frame) return true;
          const x = frame.left + touch.clientX, y = frame.top + touch.clientY;
          return Array.from(viewer.current?.querySelectorAll('.shared-highlight rect') || []).some(mark => {
            const box = mark.getBoundingClientRect();
            return x >= box.left - 6 && x <= box.right + 6 && y >= box.top - 6 && y <= box.bottom + 6;
          });
        };
        const start = (event: TouchEvent) => {
          cancel();
          if (event.touches.length !== 1 || blocked()) return;
          const target = event.target as Element | null;
          if (target?.closest?.('a, button, input, textarea, select, [contenteditable], .shared-highlight')) return;
          const touch = event.touches[0];
          if (onHighlight(touch)) return;
          gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY, started: Date.now() };
        };
        const move = (event: TouchEvent) => {
          if (!gesture) return;
          if (event.touches.length !== 1 || blocked()) { cancel(); return; }
          const touch = event.touches[0];
          const dx = Math.abs(touch.clientX - gesture.x), dy = Math.abs(touch.clientY - gesture.y);
          if (touch.identifier !== gesture.id || Date.now() - gesture.started > 450 ||
              (dy > 12 && dy > dx) || onHighlight(touch)) cancel();
        };
        const end = (event: TouchEvent) => {
          const completed = gesture;
          cancel(); // Consume before navigation: one gesture can issue only one turn.
          if (!completed || event.touches.length || event.changedTouches.length !== 1 || blocked()) return;
          const touch = event.changedTouches[0];
          const dx = touch.clientX - completed.x, dy = touch.clientY - completed.y;
          if (touch.identifier !== completed.id || Date.now() - completed.started > 450 ||
              Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 2 || onHighlight(touch)) return;
          const state = swipeState.current;
          if ((dx < 0 && state.atEnd) || (dx > 0 && state.atStart)) return;
          void swipeNavigate.current(dx < 0 ? 'next' : 'prev');
        };
        const selectionChanged = () => { if (!content.window.getSelection()?.isCollapsed) cancel(); };
        // Passive listeners leave native text selection and vertical gestures intact.
        doc.addEventListener('touchstart', start, { passive: true });
        doc.addEventListener('touchmove', move, { passive: true });
        doc.addEventListener('touchend', end, { passive: true });
        doc.addEventListener('touchcancel', cancel);
        doc.addEventListener('selectionchange', selectionChanged);
        doc.addEventListener('contextmenu', cancel);
        attached.set(doc, () => {
          cancel();
          doc.removeEventListener('touchstart', start);
          doc.removeEventListener('touchmove', move);
          doc.removeEventListener('touchend', end);
          doc.removeEventListener('touchcancel', cancel);
          doc.removeEventListener('selectionchange', selectionChanged);
          doc.removeEventListener('contextmenu', cancel);
        });
      }
    };
    attach();
    reader.on('rendered', attach);
    return () => {
      reader.off('rendered', attach);
      attached.forEach(cleanup => cleanup());
      attached.clear();
    };
  }, [loading, room.bookUrl]);

  function clearSelection() {
    // epub.js returns an array at runtime; its bundled getContents typing is incorrect.
    const contents = rendition.current?.getContents() as unknown as Contents[] | undefined;
    contents?.forEach(content => content.window.getSelection()?.removeAllRanges());
    setSelection(null);
  }

  async function navigate(target: "prev" | "next" | string) {
    const reader = rendition.current;
    if (!reader || navigationBusy.current) return;
    navigationBusy.current = true;
    clearSelection();
    setTurning(true); setError("");
    try {
      if (target === "prev") await reader.prev();
      else if (target === "next") await reader.next();
      else await reader.display(target);
    } catch { setError("Could not turn to that position. Try reopening the room."); }
    finally { navigationBusy.current = false; setTurning(false); }
  }

  function openAudio() {
    if (!rendition.current || navigationBusy.current) return;
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

  return <main className="reader">
    <div id="reader-details" hidden={!detailsExpanded}>
    <section className="reader-status" aria-label="Reader positions">
      <div><strong>You</strong><span>{me.section}</span><span className={me.done ? "done" : "muted"}>{me.done ? "Done here" : "Reading"}</span></div>
      <div><strong>Partner <small>{online ? "· online" : "· offline"}</small></strong>
        <span>{partner.cfi ? partner.section : "Waiting for partner"}</span>
        <span className={partner.done ? "done" : "muted"}>{partner.cfi ? `${partner.done ? "Done here" : "Reading"}${online ? "" : " · last seen"}` : "Share the room code"}</span>
      </div>
      <button className="secondary room-exit" onClick={onExit} aria-label="Exit" title="Exit room"><Image src="/icons/open-door.png" alt="" width={24} height={24} unoptimized /></button>
    </section>
    <p className="connection" role="status">{connection}</p>
    </div>
    <div className="reader-toolbar">
      <button className="secondary" disabled={!partner.cfi || loading || turning} onClick={() => navigate(partner.cfi)}>Jump to partner</button>
      <button className="secondary details-toggle" disabled={loading || turning || !!highlightDialog} onClick={openAudio} aria-label="Listen to page" title="Listen to page">
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 14v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="12" width="4" height="8" rx="2"/><rect x="17" y="12" width="4" height="8" rx="2"/></svg>
      </button>
      <button className="secondary details-toggle" aria-expanded={detailsExpanded} aria-controls="reader-details" aria-label={detailsExpanded ? "Collapse room details" : "Expand room details"} onClick={() => setDetailsExpanded(expanded => !expanded)}>
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d={detailsExpanded ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} /></svg>
      </button>
    </div>
    {(error || storageError || highlightError) && <p className="error reader-error" role="alert">{error || storageError || highlightError}</p>}
    <div className="book-area"><div ref={viewer} className="book-view" aria-label="EPUB reader" />{loading && <p className="book-loading" role="status">Opening EPUB…</p>}
      {selection && <div className="selection-actions">
        <button onClick={() => { setHighlightDialog({ draft: selection }); clearSelection(); }}>Highlight selection</button>
        <button className="secondary" onClick={clearSelection} aria-label="Dismiss selection">×</button>
      </div>}
    </div>
    {highlightDialog && <HighlightDialog state={highlightDialog} highlights={highlights} seat={room.seat}
      onClose={() => { setHighlightDialog(null); clearSelection(); }}
      onSave={async input => { await save(input); notifyHighlights(); }}
      onRemove={async id => { await remove(id); notifyHighlights(); }} />}
    {audioPage && <PageAudio code={room.code} text={audioPage.text} apiKey={audioKey} setApiKey={setAudioKey} preferredVoice={audioVoice} setPreferredVoice={setAudioVoice} onClose={closeAudio} />}
    <footer className="reader-controls">
      <button className="secondary" disabled={loading || turning || atStart} onClick={() => navigate("prev")} aria-label="Previous page">← Previous</button>
      <button aria-pressed={me.done} disabled={loading || !me.cfi} onClick={() => update({ ...current.current, done: !current.current.done })}>{me.done ? "Keep reading" : "Done here"}</button>
      <button className="secondary" disabled={loading || turning || atEnd} onClick={() => navigate("next")} aria-label="Next page">Next →</button>
    </footer>
  </main>;
}
