export type Position = { cfi: string; section: string; done: boolean };
export type Room = {
  code: string;
  title: string;
  seat: 1 | 2;
  topic: string;
  bookUrl: string;
};
export const EMPTY_POSITION: Position = { cfi: "", section: "Opening book", done: false };
export const MAX_EPUB_BYTES = 25 * 1024 * 1024;

export function isPosition(value: unknown): value is Position {
  if (!value || typeof value !== "object") return false;
  const p = value as Position;
  return typeof p.cfi === "string" && p.cfi.length < 4096 &&
    (p.cfi === "" || /^epubcfi\(.+\)$/.test(p.cfi)) &&
    typeof p.section === "string" && p.section.length <= 300 && typeof p.done === "boolean";
}
