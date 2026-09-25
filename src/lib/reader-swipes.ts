import type { Contents, Rendition } from "epubjs";

type Direction = "next" | "prev";

export function attachReaderSwipes(reader: Rendition, viewer: HTMLElement, options: {
  isBlocked: (content: Contents) => boolean;
  canTurn: (direction: Direction) => boolean;
  navigate: (direction: Direction) => void;
}) {
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
      // Annotations are SVG overlays in the parent, not children of the iframe.
      const onHighlight = (touch: Touch) => {
        const frame = content.window.frameElement?.getBoundingClientRect();
        if (!frame) return true;
        const x = frame.left + touch.clientX, y = frame.top + touch.clientY;
        return Array.from(viewer.querySelectorAll('.shared-highlight rect')).some(mark => {
          const box = mark.getBoundingClientRect();
          return x >= box.left - 6 && x <= box.right + 6 && y >= box.top - 6 && y <= box.bottom + 6;
        });
      };
      const start = (event: TouchEvent) => {
        cancel();
        if (event.touches.length !== 1 || options.isBlocked(content)) return;
        const target = event.target as Element | null;
        if (target?.closest?.('a, button, input, textarea, select, [contenteditable], .shared-highlight')) return;
        const touch = event.touches[0];
        if (onHighlight(touch)) return;
        gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY, started: Date.now() };
      };
      const move = (event: TouchEvent) => {
        if (!gesture) return;
        if (event.touches.length !== 1 || options.isBlocked(content)) { cancel(); return; }
        const touch = event.touches[0];
        const dx = Math.abs(touch.clientX - gesture.x), dy = Math.abs(touch.clientY - gesture.y);
        if (touch.identifier !== gesture.id || Date.now() - gesture.started > 450 ||
            (dy > 12 && dy > dx) || onHighlight(touch)) cancel();
      };
      const end = (event: TouchEvent) => {
        const completed = gesture;
        cancel(); // Consume before navigation: one gesture can issue only one turn.
        if (!completed || event.touches.length || event.changedTouches.length !== 1 || options.isBlocked(content)) return;
        const touch = event.changedTouches[0];
        const dx = touch.clientX - completed.x, dy = touch.clientY - completed.y;
        if (touch.identifier !== completed.id || Date.now() - completed.started > 450 ||
            Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 2 || onHighlight(touch)) return;
        const direction = dx < 0 ? "next" : "prev";
        if (options.canTurn(direction)) options.navigate(direction);
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
}
