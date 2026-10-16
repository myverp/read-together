import type { Highlight } from "./highlights.ts";
import type { Chapter } from "./reader-navigation.ts";

export function noteSection(chapters: Chapter[], index: number): string {
  function find(items: Chapter[]): string | undefined {
    for (const item of items) {
      if (item.index === index) return item.label;
      const nested = find(item.children);
      if (nested) return nested;
    }
  }
  return find(chapters) || `Section ${index + 1}`;
}

export type ReaderNote = Highlight & { section: string; target: string | null };
export type NoteAuthor = "all" | "mine" | "partner";
export function filterNotes(notes: ReaderNote[], seat: 1 | 2, author: NoteAuthor, query: string) {
  const search = query.trim().normalize("NFKC").toLowerCase();
  return notes.filter(note => (author === "all" || (author === "mine" ? note.seat === seat : note.seat !== seat)) &&
    `${note.quote}\n${note.comment}\n${note.section}`.normalize("NFKC").toLowerCase().includes(search));
}

// Treat book text and comments as literal text, including in Markdown viewers.
function literal(value: string) {
  return value.replace(/\r\n?/g, "\n").replace(/[\\`*_{}\[\]()#+.!|>~-]/g, "\\$&")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;");
}
export function notesMarkdown(title: string, notes: ReaderNote[], seat: 1 | 2) {
  return `# ${literal(title).replace(/\n/g, " ")}\n\nMy highlights and comments\n\n` +
    notes.filter(note => note.seat === seat).map(note =>
      `## ${literal(note.section).replace(/\n/g, " ")}\n\n${literal(note.quote).split("\n").map(line => `> ${line}`).join("\n")}\n\n${note.comment ? `${literal(note.comment)}\n\n` : ""}`
    ).join("---\n\n");
}
