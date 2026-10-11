"use client";
import { useEffect, useRef } from "react";
import type { Chapter } from "@/lib/reader-navigation";

export default function ReaderContents({ chapters, index, busy, error, onNavigate, onClose }: {
  chapters: Chapter[]; index: number | null; busy: boolean; error: string;
  onNavigate: (chapter: Chapter) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current; element?.showModal();
    return () => { element?.close(); previous?.focus(); };
  }, []);
  const list = (items: Chapter[]) => <ol>{items.map(chapter => <li key={chapter.id}>
    <button className="secondary" disabled={busy || !chapter.target} onClick={() => onNavigate(chapter)}
      aria-current={chapter.index === index && !chapter.target?.includes("#") ? "location" : undefined}>
      {chapter.label}{chapter.index === index && !chapter.target?.includes("#") && <span className="chapter-current"> · Current section</span>}
    </button>
    {!chapter.target && <span className="muted"> Unavailable section</span>}
    {chapter.children.length > 0 && list(chapter.children)}
  </li>)}</ol>;
  return <dialog ref={dialog} className="panel reader-dialog contents-dialog" aria-labelledby="contents-title" onCancel={onClose}>
    <h2 id="contents-title">Contents</h2>
    <nav aria-label="Book contents">{chapters.length ? list(chapters) : <p>No sections are available in this book.</p>}</nav>
    {busy && <p role="status">Opening section…</p>}
    {error && <p className="error" role="alert">{error}</p>}
    <button className="secondary" onClick={onClose}>Close contents</button>
  </dialog>;
}
