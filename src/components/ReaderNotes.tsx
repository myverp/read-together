"use client";
import { useEffect, useRef, useState } from "react";
import { filterNotes, notesMarkdown, type NoteAuthor, type ReaderNote } from "@/lib/reader-notes";
import type { HighlightEdit } from "@/lib/highlights";

export default function ReaderNotes({ notes, title, seat, loaded, syncError, navigationError, navigating, readOnly, onRefresh, onNavigate, onEdit, onRemove, onClose }: {
  notes: ReaderNote[]; title: string; seat: 1 | 2; loaded: boolean; syncError: string; navigationError: string; navigating: boolean; readOnly: boolean;
  onRefresh: () => Promise<void>; onNavigate: (target: string) => Promise<boolean>; onEdit: (input: HighlightEdit) => Promise<void>;
  onRemove: (id: string) => Promise<void>; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const actionTrigger = useRef<HTMLButtonElement | null>(null);
  const inFlight = useRef(false);
  const [query, setQuery] = useState("");
  const [author, setAuthor] = useState<NoteAuthor>("all");
  const [editing, setEditing] = useState<ReaderNote | null>(null);
  const [draft, setDraft] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [discarding, setDiscarding] = useState(false);
  const locked = busy || navigating;
  const visible = filterNotes(notes, seat, author, query);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current; element?.showModal(); heading.current?.focus();
    return () => { element?.close(); previous?.focus(); };
  }, []);
  function restoreActionFocus() {
    requestAnimationFrame(() => { if (actionTrigger.current?.isConnected) actionTrigger.current.focus(); else heading.current?.focus(); });
  }
  function close() {
    if (locked) return;
    if (editing && draft !== editing.comment) { setDiscarding(true); return; }
    onClose();
  }
  async function perform(action: () => Promise<void>, success: string) {
    if (inFlight.current || readOnly) return;
    if (!navigator.onLine) { setError("Go online to save changes. Your draft is still here."); return; }
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    try { await action(); setEditing(null); setRemoving(null); setMessage(success); restoreActionFocus(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save changes. Try again."); void onRefresh(); }
    finally { inFlight.current = false; setBusy(false); }
  }
  function download() {
    try {
      const url = URL.createObjectURL(new Blob([notesMarkdown(title, notes, seat)], { type: "text/markdown;charset=utf-8" }));
      const link = document.createElement("a"); link.href = url; link.download = "read-together-notes.md";
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("Markdown export prepared with all your saved highlights and comments.");
    } catch { setError("Could not export your notes. Try again."); }
  }
  return <dialog ref={dialog} className="panel reader-dialog notes-dialog" aria-labelledby="notes-title" onCancel={event => { event.preventDefault(); close(); }}>
    <div className="notes-heading"><h2 id="notes-title" ref={heading} tabIndex={-1}>Notes</h2><button className="secondary" onClick={close} disabled={locked}>Close notes</button></div>
    <p className="muted">Highlights and comments in {title}</p>
    <label htmlFor="notes-search">Search notes</label><input id="notes-search" type="search" value={query} disabled={locked || !!editing || !!removing} onChange={event => setQuery(event.target.value)} placeholder="Quote, comment or section" />
    <label htmlFor="notes-author">Author</label><select id="notes-author" value={author} disabled={locked || !!editing || !!removing} onChange={event => setAuthor(event.target.value as NoteAuthor)}>
      <option value="all">All</option><option value="mine">Mine</option><option value="partner">Partner</option>
    </select>
    <button className="secondary" disabled={!loaded || !notes.some(note => note.seat === seat) || locked || !!editing || !!removing} onClick={download}>Export my notes</button>
    <p className="muted notes-export-help">Markdown file · all your saved notes, regardless of filters. Partner’s notes and drawings are excluded.</p>
    {!loaded && !syncError && <p role="status">Loading notes…</p>}
    {syncError && <div role="alert"><p>{loaded ? "Showing the last loaded notes. Recent changes may be missing." : "Notes could not load."}</p><button className="secondary" disabled={locked} onClick={() => void onRefresh()}>Retry notes</button></div>}
    {readOnly && <p role="status">This reader is view-only. Reopen the room to edit from this device.</p>}
    {editing && <form className="note-editor" onSubmit={event => { event.preventDefault(); void perform(() => onEdit({ id: editing.id, previousComment: editing.comment, comment: draft }), "Comment saved."); }}>
      <h3>Edit your comment</h3><blockquote>{editing.quote}</blockquote>
      <label htmlFor="note-comment">Comment</label><textarea id="note-comment" value={draft} maxLength={1000} rows={4} disabled={locked || readOnly} onChange={event => { setDraft(event.target.value); setDiscarding(false); }} autoFocus />
      {!notes.some(note => note.id === editing.id) && <p role="alert">This highlight was removed. Your draft is still shown here.</p>}
      <div className="note-actions"><button disabled={locked || readOnly || !notes.some(note => note.id === editing.id)} type="submit">{busy ? "Saving…" : "Save comment"}</button>
        <button className="secondary" type="button" disabled={locked} onClick={() => { setEditing(null); setDiscarding(false); setError(""); restoreActionFocus(); }}>Cancel editing</button></div>
    </form>}
    {discarding && <div role="alert"><p>Discard your unsaved comment and close Notes?</p><div className="note-actions"><button className="secondary" onClick={() => { setDiscarding(false); dialog.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus(); }}>Keep editing</button><button onClick={onClose}>Discard and close</button></div></div>}
    {(error || navigationError) && <p className="error" role="alert">{error || navigationError}</p>}
    {message && <p role="status">{message}</p>}
    {navigating && <p role="status">Opening quote…</p>}
    {loaded && !visible.length && <p>{notes.length ? "No notes match this search and author." : "No notes yet. Select text in the book to save a highlight or comment."}</p>}
    <ul className="notes-list">{visible.map(note => <li key={note.id}><article aria-label={`${note.seat === seat ? "Your" : "Partner’s"} note: ${note.quote.slice(0, 60)}`}>
      <div className="note-meta"><strong>{note.seat === seat ? "You" : "Partner"}</strong><span>{note.section}</span></div>
      <blockquote>{note.quote}</blockquote>{note.comment ? <p className="highlight-comment">{note.comment}</p> : <p className="muted">No comment</p>}
      <div className="note-actions"><button className="secondary" disabled={locked || !!editing || !!removing || readOnly || !note.target} onClick={() => { if (note.target) void onNavigate(note.target).then(ok => { if (ok) onClose(); }); }}>Go to quote</button>
        {note.seat === seat && <><button className="secondary" disabled={locked || !!editing || !!removing || readOnly} onClick={event => { actionTrigger.current = event.currentTarget; setEditing(note); setDraft(note.comment); setError(""); setMessage(""); }}>Edit comment</button>
          <button className="secondary" disabled={locked || !!editing || !!removing || readOnly} onClick={event => { actionTrigger.current = event.currentTarget; setRemoving(note.id); setError(""); setMessage(""); }}>Remove</button></>}
      </div>
      {!note.target && <p className="muted">This quote’s location is unavailable.</p>}
      {removing === note.id && <div role="group" aria-label="Confirm removal"><p>Remove this highlight and its comment for both readers?</p><div className="note-actions">
        <button disabled={locked || readOnly} onClick={() => void perform(() => onRemove(note.id), "Highlight removed.")}>Remove highlight</button><button className="secondary" disabled={locked} onClick={() => { setRemoving(null); setError(""); restoreActionFocus(); }}>Cancel removal</button>
      </div></div>}
    </article></li>)}</ul>
  </dialog>;
}
