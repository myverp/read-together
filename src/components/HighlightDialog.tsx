"use client";
import { useEffect, useRef, useState } from "react";
import { HIGHLIGHT_COLORS, type Highlight } from "@/lib/highlights";

export type Selection = { id: string; cfi: string; quote: string };
export type HighlightDialogState = { draft: Selection } | { cfi: string };

export default function HighlightDialog({ state, highlights, seat, onSave, onRemove, onClose }: {
  state: HighlightDialogState;
  highlights: Highlight[];
  seat: 1 | 2;
  onSave: (input: Selection & { comment: string }) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const draft = "draft" in state ? state.draft : null;
  const marks = "cfi" in state ? highlights.filter(h => h.cfi === state.cfi) : [];
  useEffect(() => {
    dialog.current?.showModal();
    // Avoid opening the phone keyboard until the reader taps the optional field.
    heading.current?.focus();
  }, []);
  async function perform(action: () => Promise<void>) {
    if (busy) return;
    if (!navigator.onLine) { setError("Go online to save changes. Your draft is still here."); return; }
    setBusy(true); setError("");
    try { await action(); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save. Please try again."); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="highlight-dialog" aria-labelledby="highlight-heading" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="highlight-dialog-header">
      <h2 id="highlight-heading" ref={heading} tabIndex={-1}>{draft ? "Highlight selection" : "Shared highlight"}</h2>
      <button className="secondary" onClick={onClose} disabled={busy} aria-label="Close highlight">×</button>
    </div>
    {draft ? <form onSubmit={event => { event.preventDefault(); void perform(() => onSave({ ...draft, comment })); }}>
      <blockquote>{draft.quote}</blockquote>
      <label htmlFor="highlight-comment">Comment <span className="muted">(optional)</span></label>
      <textarea id="highlight-comment" value={comment} onChange={event => setComment(event.target.value)} maxLength={1000} rows={3} placeholder="Leave a note for your partner…" disabled={busy} />
      <p className="muted">Leave blank to save just the highlight.</p>
      <button type="submit" disabled={busy}>{busy ? "Saving…" : "Save highlight"}</button>
    </form> : marks.length ? marks.map(mark => <article key={mark.id} className="highlight-note" style={{ borderColor: HIGHLIGHT_COLORS[mark.color] }}>
      <strong>{mark.seat === seat ? "Your highlight" : "Partner’s highlight"}</strong>
      <blockquote>{mark.quote}</blockquote>
      {mark.comment ? <p className="highlight-comment">{mark.comment}</p> : <p className="muted">No comment</p>}
      {mark.seat === seat && <button className="secondary" disabled={busy} onClick={() => void perform(() => onRemove(mark.id))}>Remove highlight</button>}
    </article>) : <p>This highlight has been removed.</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </dialog>;
}
