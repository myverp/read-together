import { EpubCFI, type Book } from "epubjs";
import type Section from "epubjs/types/section";
import { noteSection } from "./reader-notes";
import type { Chapter } from "./reader-navigation";

export type BookMatch = { cfi: string; excerpt: string; section: string };

// Search inert section documents, never the visible rendition or a live iframe.
export function sectionMatches(doc: Document, query: string, base: string, limit: number): Omit<BookMatch, "section">[] {
  const root = doc.querySelector("body");
  if (!root) return [];
  let text = "";
  const nodes: { node: Text; start: number; end: number }[] = [];
  function visit(node: Node) {
    if (node.nodeType === 3) {
      const value = node.textContent || "";
      nodes.push({ node: node as Text, start: text.length, end: text.length + value.length }); text += value;
    } else if (node.nodeType === 1) {
      const element = node as Element;
      if (/^(script|style|noscript|template|svg)$/i.test(element.localName) || element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true") return;
      const block = /^(p|div|section|h[1-6]|li|br|tr)$/i.test(element.localName);
      if (block) text += "\n";
      for (const child of Array.from(node.childNodes)) visit(child);
      if (block) text += "\n";
    }
    if (text.length > 2_000_000) throw new Error("Section too large to search");
  }
  visit(root);
  const escaped = query.trim().split(/\s+/u).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  if (!escaped) return [];
  const expression = new RegExp(escaped, "giu");
  const result: Omit<BookMatch, "section">[] = [];
  for (const match of text.matchAll(expression)) {
    const start = nodes.find(item => item.end > match.index && item.start <= match.index);
    if (!start) continue;
    const range = doc.createRange(); range.setStart(start.node, match.index - start.start); range.collapse(true);
    result.push({ cfi: new EpubCFI(range, base).toString(), excerpt: `${match.index > 65 ? "…" : ""}${text.slice(Math.max(0, match.index - 65), match.index + match[0].length + 95).replace(/\s+/g, " ").trim()}…` });
    if (result.length >= limit) break;
  }
  return result;
}

export async function searchBook(book: Book, chapters: Chapter[], query: string, signal: AbortSignal, progress: (count: number, total: number) => void) {
  const sections: { href: string; index: number; cfiBase: string }[] = [];
  book.spine.each((section: Section) => { sections.push(section); });
  const items: BookMatch[] = []; let failed = 0;
  for (const [index, section] of sections.entries()) {
    signal.throwIfAborted();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const doc = await Promise.race([book.load(section.href), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Section timeout")), 10000); })]);
      signal.throwIfAborted();
      items.push(...sectionMatches(doc as Document, query, section.cfiBase, 201 - items.length).map(item => ({ ...item, section: noteSection(chapters, section.index) })));
    } catch (error) { if (signal.aborted) throw error; failed++; }
    finally { clearTimeout(timer); }
    progress(index + 1, sections.length);
    if (items.length > 200) return { items: items.slice(0, 200), limited: true, failed };
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  return { items, limited: false, failed };
}
