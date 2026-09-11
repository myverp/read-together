"use client";
import { useEffect, useRef, useState } from "react";
import ePub, { type Book, type Rendition, type Location, type Contents } from "epubjs";
import { useRoom } from "@/lib/use-room";
import type { Room } from "@/lib/types";
import { useHighlights } from "@/lib/use-highlights";
import { HIGHLIGHT_COLORS } from "@/lib/highlights";
import HighlightDialog, { type Selection, type HighlightDialogState } from "./HighlightDialog";

export default function Reader({ room, onExit }: { room: Room; onExit: () => void }) {
  const { highlights, error: highlightError, refresh, save, remove } = useHighlights(room.code);
  const { me, partner, online, connection, storageError, update, notifyHighlights } = useRoom(room, refresh);
  const viewer = useRef<HTMLDivElement>(null);
  const rendition = useRef<Rendition | null>(null);
  const current = useRef(me);
  const publish = useRef(update);
  const [loading, setLoading] = useState(true);
  const [turning, setTurning] = useState(false);
  const [error, setError] = useState("");
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(true);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [highlightDialog, setHighlightDialog] = useState<HighlightDialogState | null>(null);
  const shownDialog = useRef(highlightDialog);
  shownDialog.current = highlightDialog;
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
        const reader = book.renderTo(element, {
          width: element.clientWidth, height: element.clientHeight,
          flow: "paginated", spread: "none", manager: "default",
          allowScriptedContent: false,
        });
        rendition.current = reader;
        const captureSelection = (cfi: string, contents: Contents) => {
          if (disposed || shownDialog.current) return;
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
          if (!disposed && element.clientWidth && element.clientHeight) reader.resize(element.clientWidth, element.clientHeight);
        });
        resize.observe(element);
        // WebKit can omit selectionchange callbacks inside sandboxed EPUB frames.
        // Read from the trusted parent instead; never enable scripts in the book.
        selectionTimer = setInterval(() => {
          if (disposed || shownDialog.current || document.visibilityState !== "visible") return;
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

  function clearSelection() {
    // epub.js returns an array at runtime; its bundled getContents typing is incorrect.
    const contents = rendition.current?.getContents() as unknown as Contents[] | undefined;
    contents?.forEach(content => content.window.getSelection()?.removeAllRanges());
    setSelection(null);
  }

  async function navigate(target: "prev" | "next" | string) {
    const reader = rendition.current;
    if (!reader || turning) return;
    clearSelection();
    setTurning(true); setError("");
    try {
      if (target === "prev") await reader.prev();
      else if (target === "next") await reader.next();
      else await reader.display(target);
    } catch { setError("Could not turn to that position. Try reopening the room."); }
    finally { setTurning(false); }
  }

  return <main className="reader">
    <div id="reader-details" hidden={!detailsExpanded}>
    <section className="reader-status" aria-label="Reader positions">
      <div><strong>You</strong><span>{me.section}</span><span className={me.done ? "done" : "muted"}>{me.done ? "Done here" : "Reading"}</span></div>
      <div><strong>Partner <small>{online ? "· online" : "· offline"}</small></strong>
        <span>{partner.cfi ? partner.section : "Waiting for partner"}</span>
        <span className={partner.done ? "done" : "muted"}>{partner.cfi ? `${partner.done ? "Done here" : "Reading"}${online ? "" : " · last seen"}` : "Share the room code"}</span>
      </div>
      <button className="secondary" onClick={onExit}>Exit</button>
    </section>
    <p className="connection" role="status">{connection}</p>
    </div>
    <div className="reader-toolbar">
      <button className="secondary" disabled={!partner.cfi || loading || turning} onClick={() => navigate(partner.cfi)}>Jump to partner</button>
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
    <footer className="reader-controls">
      <button className="secondary" disabled={loading || turning || atStart} onClick={() => navigate("prev")} aria-label="Previous page">← Previous</button>
      <button aria-pressed={me.done} disabled={loading || !me.cfi} onClick={() => update({ ...current.current, done: !current.current.done })}>{me.done ? "Keep reading" : "Done here"}</button>
      <button className="secondary" disabled={loading || turning || atEnd} onClick={() => navigate("next")} aria-label="Next page">Next →</button>
    </footer>
  </main>;
}
