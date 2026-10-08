"use client";
import InviteDialog from "./InviteDialog";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import ReaderMenu from "./ReaderMenu";
import ReaderIcon from "./ReaderIcon";
import ReaderRoomDetails from "./ReaderRoomDetails";
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
import ReaderContents from "./ReaderContents";
import { bookChapters, type Chapter } from "@/lib/reader-navigation";
import ReadingSettingsDialog from "./ReadingSettingsDialog";
import { loadSettings, saveSettings, READING_PALETTES, type ReadingSettings } from "@/lib/reading-settings";
import { browserStorage } from "@/lib/local-progress";
import { registerReadingThemes, themeName } from "@/lib/reader-themes";

export default function Reader({ room, onExit }: { room: Room; onExit: (warning?: string) => void }) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [contentsOpen, setContentsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const dialogTrigger = useRef<HTMLButtonElement | null>(null);
  const restoreDialogFocus = useRef(false);
  const [initialSettings] = useState(() => loadSettings(browserStorage()));
  const [settings, setSettings] = useState(initialSettings.settings);
  const settingsRef = useRef(settings);
  const [settingsStorage, setSettingsStorage] = useState(initialSettings.available);
  const [fixedLayout, setFixedLayout] = useState(false);
  const reflow = useRef<() => void>(() => {});
  const resizePending = useRef(false);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [sectionIndex, setSectionIndex] = useState<number | null>(null);
  const modalOpen = useRef(false);
  const [demoTip, setDemoTip] = useState(false);
  useEffect(() => { try { setDemoTip(localStorage.getItem("read-together:demo") === room.code); } catch { /* Optional hint. */ } }, [room.code]);
  const { highlights, colors, error: highlightError, refresh, save, remove } = useHighlights(room.code);
  const { drawings, error: drawingError, refresh: refreshDrawings, save: saveDrawing, remove: removeDrawing } = useDrawings(room.code);
  const refreshAnnotations = useCallback(() => { void refresh(); void refreshDrawings(); }, [refresh, refreshDrawings]);
  const { me, partner, online, connection, storageError, syncState, retrySync, keepLocal, useCloud, stalePending, restoreLocal, update, notifyHighlights, takenOver, flushProgress } = useRoom(room, refreshAnnotations);
  const [exiting, setExiting] = useState(false);
  const exitBusy = useRef(false);
  const [unsafeExit, setUnsafeExit] = useState(false);
  const viewer = useRef<HTMLDivElement>(null);
  const rendition = useRef<Rendition | null>(null);
  const openedBook = useRef<Book | null>(null);
  const current = useRef(me);
  // Saved CFI is a text anchor. Opening/reflow must not replace it with the
  // beginning of a differently sized page; navigation chooses a new anchor.
  const layoutAnchor = useRef<string | null>(me.cfi || null);
  const publish = useRef(update);
  const [loading, setLoading] = useState(true);
  const [turning, setTurning] = useState(false);
  const navigationBusy = useRef(false);
  const navigationDone = useRef<Promise<void> | null>(null);
  const operation = useRef<{ ready: boolean; index: number | null; confirm: (location: Location) => void } | null>(null);
  const ignoreRelocations = useRef(false);
  const [error, setError] = useState("");
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
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
  modalOpen.current = menuOpen || detailsExpanded || contentsOpen || settingsOpen || inviteOpen || !!highlightDialog || drawingModal || !!audioPage;
  reflow.current = () => {
    if (!viewer.current || loading || navigationBusy.current || audioOpen.current || drawing || drawingModal || highlightDialog) { resizePending.current = true; return; }
    resizePending.current = false;
    void navigate(current.current.cfi, false, undefined, { resize: true });
  };
  const swipeState = useRef({ loading, selection, highlightDialog, atStart, atEnd, drawing, drawingModal });
  swipeState.current = { loading, selection, highlightDialog, atStart, atEnd, drawing, drawingModal };
  const swipeNavigate = useRef(navigate);
  swipeNavigate.current = navigate;
  current.current = me;
  publish.current = update;
  const setAudioController = useCallback((controller: PageAudioController | null) => { audioController.current = controller; }, []);

  useEffect(() => { if (resizePending.current && !loading && !turning && !drawing && !drawingModal && !highlightDialog && !audioPage) reflow.current(); }, [loading, turning, drawing, drawingModal, highlightDialog, audioPage]);
  useEffect(() => {
    if (restoreDialogFocus.current && !contentsOpen && !settingsOpen && !audioPage && !turning && !loading && !navigationBusy.current) {
      restoreDialogFocus.current = false;
      dialogTrigger.current?.focus();
    }
  }, [contentsOpen, settingsOpen, audioPage, turning, loading]);
  function closeReadingDialog() {
    restoreDialogFocus.current = true;
    setContentsOpen(false); setSettingsOpen(false);
  }

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
        openedBook.current = book;
        setChapters(bookChapters(book));
        let fixed = book.packaging.metadata.layout === "pre-paginated";
        book.spine.each((section: { properties: string[] }) => { if (section.properties.includes("rendition:layout-pre-paginated")) fixed = true; });
        setFixedLayout(fixed);
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
        // epub.js handles book links through its own display(), outside navigate().
        // Clear the reflow anchor before that queued display reports relocation.
        reader.hooks.content.register((contents: Contents) => {
          contents.on("linkClicked", () => { layoutAnchor.current = null; });
        });
        const captureSelection = (cfi: string, contents: Contents) => {
          if (disposed || controlLost.current || navigationBusy.current || modalOpen.current || audioOpen.current || drawingRef.current) return;
          const quote = contents.window.getSelection()?.toString().trim();
          if (!quote) return;
          if (quote.length > 3000) { setError("Select a shorter passage (up to 3,000 characters)."); setSelection(null); return; }
          setError("");
          setSelection(previous => previous?.cfi === cfi && previous.quote === quote ? previous : { id: crypto.randomUUID(), cfi, quote });
        };
        reader.on("selected", captureSelection);
        registerReadingThemes(reader, fixed);
        reader.themes.select(themeName(settingsRef.current));
        reader.on("relocated", (location: Location) => {
          if (disposed || controlLost.current) return;
          const active = operation.current;
          if (active) {
            if (active.ready && (active.index === null || active.index === location.start.index)) active.confirm(location);
            return;
          }
          if (ignoreRelocations.current) return;
          setSectionIndex(location.start.index);
          setAtStart(location.atStart); setAtEnd(location.atEnd);
          const label = book?.navigation.get(location.start.href)?.label?.trim();
          const cfi = layoutAnchor.current || location.start.cfi;
          const next = {
            cfi,
            section: `p. ${location.start.displayed.page} · ${label || `Section ${location.start.index + 1}`}`.slice(0, 300),
            done: cfi === current.current.cfi ? current.current.done : false,
          };
          // Reflow can emit the same location repeatedly; do not resend unchanged Presence.
          if (next.cfi === current.current.cfi && next.section === current.current.section && next.done === current.current.done) return;
          current.current = next;
          publish.current(next);
        });
        reader.on("displayError", () => { if (!disposed) { layoutAnchor.current = current.current.cfi || null; setError("This section could not be displayed. Try reopening the room with a DRM-free EPUB."); } });
        await reader.display(current.current.cfi || undefined);
        if (disposed) return;
        // Explicit dimensions prevent the iframe from expanding the mobile viewport.
        let width = element.clientWidth, height = element.clientHeight;
        resize = new ResizeObserver(() => {
          if (!disposed && element.clientWidth && element.clientHeight && (width !== element.clientWidth || height !== element.clientHeight)) {
            width = element.clientWidth; height = element.clientHeight;
            reflow.current();
          }
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
      rendition.current = null; openedBook.current = null; operation.current = null; book?.destroy();
    };
  }, [room.bookUrl]);

  useEffect(() => {
    const reader = rendition.current;
    if (!reader || loading) return;
    // epub.js keys annotations by CFI: identical selections share one clickable overlay.
    const groups = new Map(highlights.map(mark => [mark.cfi, mark]));
    const openMark = (cfi: string) => { if (navigationBusy.current) return; audioController.current?.pause(); setSelection(null); setHighlightDialog({ cfi }); };
    groups.forEach(mark => {
      try {
        reader.annotations.highlight(mark.cfi, { id: mark.id }, () => openMark(mark.cfi), "shared-highlight", {
          fill: HIGHLIGHT_COLORS[mark.color], "fill-opacity": "0.32", "mix-blend-mode": settings.theme === "dark" ? "normal" : "multiply",
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
  }, [highlights, loading, room.seat, settings.theme]);

  useEffect(() => {
    const reader = rendition.current;
    const element = viewer.current;
    if (!reader || !element || loading) return;
    return attachReaderSwipes(reader, element, {
      isBlocked: content => {
        const state = swipeState.current;
        const selected = content.window.getSelection();
        return state.loading || state.drawing || state.drawingModal || modalOpen.current || audioOpen.current || navigationBusy.current || !!state.selection || !!state.highlightDialog ||
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

  async function navigate(target: "prev" | "next" | string, continuing = false, chapter?: Chapter, layout?: { settings?: ReadingSettings; resize?: boolean }) {
    const reader = rendition.current;
    if (!reader || navigationBusy.current || exitBusy.current || controlLost.current || drawingRef.current || drawingModal || shownDialog.current) return false;
    if (!continuing) audioController.current?.stop();
    navigationBusy.current = true;
    let finishNavigation!: () => void;
    navigationDone.current = new Promise<void>(resolve => { finishNavigation = resolve; });
    const previous = { ...current.current };
    const previousSettings = settingsRef.current;
    layoutAnchor.current = target.startsWith("epubcfi(") ? target : null;
    clearSelection();
    setTurning(true); if (!layout?.resize) setError("");
    // next()/prev()/display() resolve before epub.js reports the text position
    // on an animation frame. Keep controls busy until that position is saved.
    let confirm!: (value: Location) => void;
    const location = new Promise<Location>(resolve => { confirm = resolve; });
    const active = { ready: false, index: chapter?.index ?? (target.startsWith("epubcfi(") ? openedBook.current?.spine.get(target)?.index ?? null : null), confirm };
    operation.current = active;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const confirmed = await Promise.race([
        (async () => {
          // Drain already scheduled location frames before issuing this operation.
          // Otherwise an old same-section relocation can confirm a new reflow.
          await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
          if (operation.current !== active) throw new Error("Cancelled navigation");
          if (layout) {
            if (layout.settings) reader.themes.select(themeName(layout.settings));
            // Recreate only the section view with the existing book and theme.
            // This formats author CSS before restoring the confirmed text anchor.
            reader.clear();
            const element = viewer.current;
            if (element && layout.resize) (reader as unknown as { resize: (width: number, height: number, cfi: string) => void }).resize(element.clientWidth, element.clientHeight, target);
          }
          if (chapter?.target?.includes("#")) {
            const section = openedBook.current?.spine.get(chapter.target);
            if (!section) throw new Error("Missing section");
            await section.load(openedBook.current?.request);
            const passage = section.document.getElementById(decodeURIComponent(chapter.target.split("#").slice(1).join("#")));
            if (!passage) throw new Error("Missing passage");
            // The target passage is a stable text anchor; the beginning of its
            // screen page can move away from it on the following resize.
            const text = section.document.createTreeWalker(passage, NodeFilter.SHOW_TEXT);
            let first = text.nextNode();
            while (first && !first.textContent?.trim()) first = text.nextNode();
            if (first) {
              const range = section.document.createRange();
              range.setStart(first, first.textContent!.search(/\S/)); range.collapse(true);
              layoutAnchor.current = section.cfiFromRange(range);
            } else layoutAnchor.current = section.cfiFromElement(passage);
            if (operation.current !== active) throw new Error("Cancelled navigation");
          }
          if (target === "prev") await reader.prev();
          else if (target === "next") await reader.next();
          else await reader.display(chapter?.target?.includes("#") ? layoutAnchor.current! : target);
          if (layout) {
            // Content hooks apply the theme after the manager's first display.
            // Let its geometry settle before positioning the text anchor again.
            await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
            if (operation.current !== active) throw new Error("Cancelled navigation");
            await reader.display(target);
          }
          if (operation.current !== active) throw new Error("Cancelled navigation");
          active.ready = true;
          return await location;
        })(),
        new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error("Page turn timed out")), 5000); }),
      ]);
      if (controlLost.current || rendition.current !== reader || operation.current !== active) return false;
      ignoreRelocations.current = false;
      setSectionIndex(confirmed.start.index); setAtStart(confirmed.atStart); setAtEnd(confirmed.atEnd);
      const cfi = layoutAnchor.current || confirmed.start.cfi;
      const label = chapter?.label || openedBook.current?.navigation.get(confirmed.start.href)?.label?.trim();
      const next = layout ? previous : { cfi, section: `p. ${confirmed.start.displayed.page} · ${label || `Section ${confirmed.start.index + 1}`}`.slice(0, 300), done: cfi === previous.cfi ? previous.done : false };
      current.current = next;
      // Technical reflow keeps the text anchor and Done state, without synthetic Presence.
      if (!layout) publish.current(next);
      if (layout?.settings) { settingsRef.current = layout.settings; setSettings(layout.settings); setSettingsStorage(saveSettings(browserStorage(), layout.settings)); }
      if (audioOpen.current && !continuing) setAudioPage(visiblePageText(reader));
      return true;
    } catch {
      ignoreRelocations.current = true; layoutAnchor.current = previous.cfi || null;
      if (layout) {
        reader.themes.select(themeName(previousSettings)); reader.clear();
        // Recover the view without accepting a late callback from the failed reflow.
        void reader.display(previous.cfi).catch(() => {});
      }
      setError(layout ? "Could not apply reading settings. Your previous settings and position are kept. Try again." : "Could not open that position. Retry the section or close and reopen the room."); return false;
    }
    finally {
      clearTimeout(deadline); if (operation.current === active) operation.current = null;
      navigationBusy.current = false; setTurning(false);
      finishNavigation(); navigationDone.current = null;
    }
  }

  function changeSettings(next: ReadingSettings) {
    if (!rendition.current || loading || navigationBusy.current || exitBusy.current || controlLost.current || drawingRef.current || drawingModal || shownDialog.current) return;
    if (next.theme === settingsRef.current.theme && next.fontSize === settingsRef.current.fontSize) return;
    setSettings(next);
    void navigate(current.current.cfi, false, undefined, { settings: next }).then(ok => { if (!ok) setSettings(settingsRef.current); });
  }

  function openAudio() {
    if (!rendition.current || navigationBusy.current || controlLost.current || drawingRef.current) return;
    try {
      const page = visiblePageText(rendition.current);
      clearSelection(); setError(""); audioOpen.current = true; setAudioPage(page);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not read this page’s text."); }
  }

  function closeAudio() {
    restoreDialogFocus.current = true;
    audioOpen.current = false; setAudioPage(null);
    // Restore layout after the settings keyboard or a device rotation.
    reflow.current();
  }

  async function nextAudioPage() {
    const currentReader = rendition.current;
    if (!currentReader || (currentReader.currentLocation() as unknown as Location | null)?.atEnd) return null;
    if (!await navigate("next", true) || !audioOpen.current) return null;
    const reader = rendition.current;
    if (!reader) return null;
    const page = visiblePageText(reader);
    setAudioPage(page);
    return page.text;
  }

  async function exitReader() {
    if (exitBusy.current) return;
    exitBusy.current = true; setExiting(true);
    audioController.current?.stop();
    try {
      await navigationDone.current;
      const result = await flushProgress();
      if (!result.safe) { setUnsafeExit(true); return; }
      onExit(result.pending ? "Your position is saved on this device. Reopen this room to finish syncing." : undefined);
    } finally { exitBusy.current = false; setExiting(false); }
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

  const syncProblem = (room.controlVersion ?? 0) > 0 && ["Could not sync", "Waiting for connection", "Sign in again to sync", "Choose which position to keep"].includes(syncState);
  const palette = READING_PALETTES[settings.theme];
  return <main className="reader" data-reading-theme={settings.theme} style={{ "--reading-bg": palette.background, "--reading-text": palette.text,
    "--surface": palette.surface, "--secondary": palette.muted, "--accent": palette.link, "--line": palette.line, "--reading-error": palette.error,
    "--reading-button-text": settings.theme === "dark" ? palette.background : "#ffffff" } as CSSProperties}>
    <header className="reader-top">
      <ReaderMenu trigger={dialogTrigger} onOpenChange={setMenuOpen} items={[
        { label: "Contents", icon: "contents", disabled: takenOver || loading || turning || startingDrawing || drawing || settingsOpen || inviteOpen || !!highlightDialog || drawingModal || !!audioPage,
          onSelect: () => { clearSelection(); audioController.current?.stop(); setError(""); setContentsOpen(true); } },
        { label: "Listen", icon: "listen", disabled: takenOver || loading || turning || drawing || drawingModal || !!highlightDialog, onSelect: openAudio },
        { label: "Reading settings", icon: "settings", disabled: takenOver || loading || turning || startingDrawing || drawing || contentsOpen || inviteOpen || !!highlightDialog || drawingModal || !!audioPage,
          onSelect: () => { clearSelection(); audioController.current?.stop(); setError(""); setSettingsOpen(true); } },
        { label: "Invite", icon: "invite", onSelect: () => setInviteOpen(true) },
        { label: "Partner", icon: "partner", disabled: takenOver || drawing || drawingModal || !partner.cfi || loading || turning, onSelect: () => { void navigate(partner.cfi); } },
        { label: "Room details", icon: "info", onSelect: () => setDetailsExpanded(true) },
      ]} />
      <button className="secondary reader-icon-button room-exit" disabled={exiting || turning} onClick={() => void exitReader()} aria-label="Exit" title="Exit room"><ReaderIcon name="exit" /></button>
    </header>
    {demoTip && <div className="demo-tip"><p>Turn a page, select a phrase to highlight, then Invite someone to read with you.</p><button className="secondary" aria-label="Dismiss demo tips" onClick={() => setDemoTip(false)}>Got it</button></div>}
    {(storageError && storageError !== "Checking device storage…" || syncProblem || stalePending) && <div className="progress-status" role="status">
      {storageError && storageError !== "Checking device storage…" && <span>{storageError}</span>}
      {syncProblem && <><span>{syncState}</span><span>{storageError.startsWith("Browser storage") ? "Latest changes are not saved on this device." : "Latest changes are saved only on this device."}</span></>}
      {(syncState === "Could not sync" || syncState === "Waiting for connection") && !takenOver && <button className="secondary" onClick={retrySync}>Retry sync</button>}
      {syncState === "Sign in again to sync" && <span>Exit and sign in again, then reopen this room.</span>}
      {syncState === "Choose which position to keep" && <><button onClick={keepLocal} disabled={takenOver || loading || turning}>Keep this position</button><button className="secondary" disabled={takenOver || loading || turning} onClick={() => { const position = useCloud(); if (position?.cfi) void navigate(position.cfi); }}>Use cloud position</button></>}
      {stalePending && <><span>A local position remains from another control session.</span><button className="secondary" disabled={takenOver || loading || turning} onClick={() => { const position = restoreLocal(); if (position?.cfi) void navigate(position.cfi); }}>Restore local position</button></>}
    </div>}
    {unsafeExit && <div className="exit-warning" role="alert"><p>Your latest position could not be saved on this device or confirmed in the cloud.</p><button onClick={() => setUnsafeExit(false)}>Stay</button><button className="secondary" onClick={() => onExit("You left without saving your latest position. It may be lost.")}>Exit without saving</button></div>}
    {(error || highlightError || drawingError) && <p className="error reader-error" role="alert">{error || highlightError || drawingError}</p>}
    {takenOver && <div className="taken-over" role="alert"><strong>Continued on another device</strong><span>This reader is now view-only. Exit and choose Continue here to take control again.</span></div>}
    <div className="book-area"><div ref={viewer} className="book-view" aria-label="EPUB reader" />{loading && <p className="book-loading" role="status">Opening EPUB…</p>}
      {!loading && <DrawingLayer reader={rendition.current} viewer={viewer.current} drawings={drawings} seat={room.seat} hidden={drawingsHidden} active={drawing} takenOver={takenOver} onCancel={cancelDrawing} onModalChange={changeDrawingModal} onSave={async input => { await saveDrawing(input); notifyHighlights(); }} onRemove={async id => { await removeDrawing(id); notifyHighlights(); }} />}
      {selection && !takenOver && !drawing && <div className="selection-actions">
        <button onClick={() => { audioController.current?.pause(); setHighlightDialog({ draft: selection }); clearSelection(); }}>Highlight selection</button>
        <button className="secondary" onClick={clearSelection} aria-label="Dismiss selection">×</button>
      </div>}
    </div>
    {detailsExpanded && <ReaderRoomDetails onClose={() => setDetailsExpanded(false)}>
    <section className="reader-status" aria-label="Reader positions">
      <div><strong>You</strong><span>{me.section}</span><span className={me.done ? "done" : "muted"}>{me.done ? "Done here" : "Reading"}</span></div>
      <div><strong>Partner <small>{online ? "· online" : "· offline"}</small></strong>
        <span>{partner.cfi ? partner.section : "Waiting for partner"}</span>
        <span className={partner.done ? "done" : "muted"}>{partner.cfi ? `${partner.done ? "Done here" : "Reading"}${online ? "" : " · last seen"}` : "Invite someone to read"}</span>
      </div>
    </section>
    <p className="connection" role="status">{connection}</p>
    <div className="room-colors" aria-label="Your room highlight color">{HIGHLIGHT_COLORS.map((color, index) => <button key={color} disabled={takenOver || index === partnerColor} className={currentColor === index ? "color-choice selected" : "color-choice"} style={{ backgroundColor: color }} aria-label={index === partnerColor ? `Color ${index + 1} is used by your partner` : `Use color ${index + 1} in this room`} aria-pressed={currentColor === index} title={index === partnerColor ? "Used by your partner" : undefined} onClick={() => void changeColor(index)} />)}</div>
    </ReaderRoomDetails>}
    {inviteOpen && <InviteDialog code={room.code} onClose={() => setInviteOpen(false)} />}
    {contentsOpen && <ReaderContents chapters={chapters} index={sectionIndex} busy={turning} error={error}
      onClose={closeReadingDialog} onNavigate={chapter => { if (chapter.target) void navigate(chapter.target, false, chapter).then(ok => { if (ok) closeReadingDialog(); }); }} />}
    {settingsOpen && <ReadingSettingsDialog settings={settings} busy={turning} fixed={fixedLayout} storageAvailable={settingsStorage} error={error}
      onChange={changeSettings} onClose={closeReadingDialog} />}
    {highlightDialog && !takenOver && <HighlightDialog state={highlightDialog} highlights={highlights} seat={room.seat}
      onClose={() => { setHighlightDialog(null); clearSelection(); }}
      onSave={async input => { await save(input); notifyHighlights(); }}
      onRemove={async id => { await remove(id); notifyHighlights(); }} />}
    {audioPage && <PageAudio code={room.code} text={audioPage.text} apiKey={audioKey} setApiKey={setAudioKey} preferredVoice={audioVoice} setPreferredVoice={setAudioVoice} onNextPage={nextAudioPage} onController={setAudioController} onClose={closeAudio} />}
    <div className="reader-eye-row">
      <button className="secondary reader-icon-button" aria-pressed={drawingsHidden} onClick={() => setDrawingsHidden(value => !value)} aria-label={drawingsHidden ? "Show drawings" : "Hide drawings"} title={drawingsHidden ? "Show drawings" : "Hide drawings"}><ReaderIcon name="eye" hidden={drawingsHidden} /></button>
    </div>
    <footer className="reader-controls">
      <button className="secondary reader-icon-button" title="Previous page" disabled={takenOver || drawing || drawingModal || loading || turning || atStart} onClick={() => navigate("prev")} aria-label="Previous page"><ReaderIcon name="prev" /></button>
      <button aria-pressed={me.done} disabled={takenOver || drawing || drawingModal || loading || turning || !me.cfi} onClick={() => update({ ...current.current, done: !current.current.done })}>{me.done ? "Keep reading" : "Done here"}</button>
      <button className="secondary reader-icon-button" disabled={takenOver || loading || turning || startingDrawing || drawing || drawingModal || !!highlightDialog} onClick={() => void startDrawing()} aria-label="Draw on page" title="Draw on page"><ReaderIcon name="draw" /></button>
      <button className="secondary reader-icon-button" title="Next page" disabled={takenOver || drawing || drawingModal || loading || turning || atEnd} onClick={() => navigate("next")} aria-label="Next page"><ReaderIcon name="next" /></button>
    </footer>
  </main>;
}
