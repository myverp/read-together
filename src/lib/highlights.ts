// Muted pigments rendered at 32% opacity over the EPUB text.
export const HIGHLIGHT_COLORS = [
  "#C6A653", "#81A984", "#68A6A0", "#7F9EBE", "#9A8CB9",
  "#B88CA6", "#C58E86", "#C6A07A", "#A4AC75", "#8CAAAE",
] as const;

export type Highlight = {
  id: string;
  cfi: string;
  quote: string;
  comment: string;
  color: number;
  seat: 1 | 2;
};
export type HighlightSnapshot = { revision: number; items: Highlight[] };
export type HighlightState = HighlightSnapshot & { colors: number[] };

export function isHighlightInput(value: unknown): value is Pick<Highlight, "id" | "cfi" | "quote" | "comment"> {
  if (!value || typeof value !== "object") return false;
  const h = value as Highlight;
  return typeof h.id === "string" && /^[a-f0-9-]{36}$/.test(h.id) &&
    typeof h.cfi === "string" && h.cfi.length <= 4096 && /^epubcfi\([^\r\n]+,[^\r\n]+,[^\r\n]+\)$/.test(h.cfi) &&
    typeof h.quote === "string" && h.quote.trim().length > 0 && h.quote.length <= 3000 &&
    typeof h.comment === "string" && h.comment.length <= 1000;
}
