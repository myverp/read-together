export type SelectionAnchor = { left: number; right: number; top: number; bottom: number };

// EPUB columns live inside a translated iframe. Child ranges are relative to
// that frame's viewport, not to the visible book area or the parent viewport.
export function selectionAnchor(selection: Selection, frame: HTMLIFrameElement, clip: DOMRect): SelectionAnchor | null {
  if (!selection.rangeCount || !selection.focusNode) return null;
  const origin = frame.getBoundingClientRect();
  const scaleX = frame.clientWidth ? origin.width / frame.clientWidth : 1;
  const scaleY = frame.clientHeight ? origin.height / frame.clientHeight : 1;
  const map = (rect: DOMRect): SelectionAnchor | null => {
    const left = origin.left + rect.left * scaleX, right = origin.left + rect.right * scaleX;
    const top = origin.top + rect.top * scaleY, bottom = origin.top + rect.bottom * scaleY;
    if (bottom <= clip.top || top >= clip.bottom || right < clip.left || left > clip.right || bottom <= top) return null;
    return { left: Math.max(clip.left, left), right: Math.min(clip.right, right), top: Math.max(clip.top, top), bottom: Math.min(clip.bottom, bottom) };
  };
  const range = selection.getRangeAt(0);
  const focus = range.cloneRange();
  try {
    focus.setStart(selection.focusNode, selection.focusOffset); focus.collapse(true);
    const endpoint = Array.from(focus.getClientRects()).map(map).find(Boolean);
    if (endpoint) return endpoint;
  } catch { /* Some engines omit the collapsed caret rectangle. */ }
  const backwards = selection.focusNode === range.startContainer && selection.focusOffset === range.startOffset;
  const rects = Array.from(range.getClientRects());
  if (!backwards) rects.reverse();
  for (const rect of rects) {
    const visible = map(rect);
    if (visible) return { ...visible, left: backwards ? visible.left : visible.right, right: backwards ? visible.left : visible.right };
  }
  return map(range.getBoundingClientRect());
}

export function selectionToolbarPosition(anchor: SelectionAnchor, bounds: SelectionAnchor, width: number, height: number) {
  const gap = 16, inset = 8;
  const left = Math.max(bounds.left + inset, Math.min(anchor.right - width / 2, bounds.right - width - inset));
  const below = anchor.bottom + gap;
  const top = below + height <= bounds.bottom - inset ? below : anchor.top - height - gap;
  return { left, top: Math.max(bounds.top + inset, Math.min(top, bounds.bottom - height - inset)) };
}
