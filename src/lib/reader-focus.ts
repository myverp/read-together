import type { Contents, Rendition } from "epubjs";

// Events inside EPUB frames do not bubble into the reader document.
export function attachFocusReveal(reader: Rendition, viewer: HTMLElement, blocked: (content: Contents) => boolean, reveal: () => void) {
  const attached = new Map<Document, () => void>();
  const attach = () => {
    const contents = reader.getContents() as unknown as Contents[];
    const active = new Set(contents.map(content => content.document));
    attached.forEach((cleanup, doc) => { if (!active.has(doc)) { cleanup(); attached.delete(doc); } });
    for (const content of contents) {
      const doc = content.document;
      if (attached.has(doc)) continue;
      let start: { id: number; x: number; y: number; time: number } | null = null;
      const cancel = () => { start = null; };
      const interactive = (target: EventTarget | null) => (target as Element | null)?.closest?.("a, button, input, textarea, select, [contenteditable], pre, code");
      const annotation = (x: number, y: number) => {
        const frame = content.window.frameElement?.getBoundingClientRect();
        if (!frame) return true;
        return Array.from(viewer.querySelectorAll('.shared-highlight rect')).some(mark => {
          const box = mark.getBoundingClientRect();
          return frame.left + x >= box.left - 6 && frame.left + x <= box.right + 6 && frame.top + y >= box.top - 6 && frame.top + y <= box.bottom + 6;
        });
      };
      const down = (event: PointerEvent) => {
        if (start || !event.isPrimary || event.button !== 0 || blocked(content) || interactive(event.target) || annotation(event.clientX, event.clientY)) { cancel(); return; }
        start = { id: event.pointerId, x: event.clientX, y: event.clientY, time: Date.now() };
      };
      const move = (event: PointerEvent) => { if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) cancel(); };
      const up = (event: PointerEvent) => {
        const gesture = start; cancel();
        if (!gesture || gesture.id !== event.pointerId || Date.now() - gesture.time > 300 || blocked(content) || interactive(event.target) || annotation(event.clientX, event.clientY)) return;
        if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 8) return;
        // A paginated iframe spans the section's columns, with a translated
        // origin after each turn. The tap zone belongs to the visible viewport.
        const viewport = viewer.getBoundingClientRect();
        const frame = content.window.frameElement?.getBoundingClientRect();
        if (!frame) return;
        const x = frame.left + event.clientX, y = frame.top + event.clientY;
        if (x < viewport.left + viewport.width * .25 || x > viewport.left + viewport.width * .75 || y < viewport.top + viewport.height * .2 || y > viewport.top + viewport.height * .8) return;
        reveal();
      };
      const key = (event: KeyboardEvent) => { if (event.key === "Escape" && !blocked(content)) { event.preventDefault(); reveal(); } };
      const selected = () => { if (!content.window.getSelection()?.isCollapsed) cancel(); };
      doc.addEventListener("pointerdown", down); doc.addEventListener("pointermove", move); doc.addEventListener("pointerup", up);
      doc.addEventListener("pointercancel", cancel); doc.addEventListener("contextmenu", cancel); doc.addEventListener("selectionchange", selected); doc.addEventListener("keydown", key);
      attached.set(doc, () => { doc.removeEventListener("pointerdown", down); doc.removeEventListener("pointermove", move); doc.removeEventListener("pointerup", up); doc.removeEventListener("pointercancel", cancel); doc.removeEventListener("contextmenu", cancel); doc.removeEventListener("selectionchange", selected); doc.removeEventListener("keydown", key); });
    }
  };
  attach(); reader.on("rendered", attach);
  return () => { reader.off("rendered", attach); attached.forEach(cleanup => cleanup()); attached.clear(); };
}
