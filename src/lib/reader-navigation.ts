import type { Book } from "epubjs";
import type Section from "epubjs/types/section";

export type Chapter = { id: string; label: string; target: string | null; index: number | null; children: Chapter[] };

// Resolve relative to the navigation document, then require an exact spine member.
// URL is used only for path normalization; epub.js supplies the package resolver.
export function chapterTarget(book: Book, href: string): { target: string; index: number } | null {
  try {
    if (!href || /[\u0000-\u0020\\]/.test(href) || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) return null;
    const nav = book.packaging.navPath || book.packaging.ncxPath || "";
    const base = new URL(book.resolve(nav), "https://epub.invalid");
    const resolved = new URL(href, base);
    if (resolved.origin !== base.origin || resolved.search) return null;
    let found: { target: string; index: number } | null = null;
    book.spine.each((section: Section) => {
      const url = new URL(book.resolve(section.href), base.origin);
      if (decodeURI(url.pathname) === decodeURI(resolved.pathname)) found = { target: section.href + resolved.hash, index: section.index };
    });
    return found;
  } catch { return null; }
}

export function bookChapters(book: Book): Chapter[] {
  let valid = 0;
  const map = (items: Book["navigation"]["toc"], prefix = ""): Chapter[] => items.map((item, i) => {
    const destination = chapterTarget(book, item.href);
    if (destination) valid++;
    const id = `${prefix}${i}`;
    return { id, label: item.label.trim() || "Untitled section", target: destination?.target ?? null,
      index: destination?.index ?? null, children: map(item.subitems || [], `${id}.`) };
  });
  const chapters = map(book.navigation.toc);
  if (valid) return chapters;
  const fallback: Chapter[] = [];
  book.spine.each((section: Section) => { if (section.linear) fallback.push({ id: `spine-${section.index}`, label: `Section ${fallback.length + 1}`,
    target: section.href, index: section.index, children: [] }); });
  return fallback;
}
