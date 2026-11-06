"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { forgetDeletedRoom } from "@/lib/forget-room";

export default function DeleteRoomDialog({ code, title, onClose, onDeleted }: {
  code: string; title: string; onClose: () => void; onDeleted: (localCleanup: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const active = useRef(true);
  const inFlight = useRef(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    active.current = true;
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    return () => { active.current = false; element?.close(); previous?.focus(); };
  }, []);
  async function remove() {
    if (inFlight.current || confirmation !== "ВИДАЛИТИ") return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      await api(`/api/rooms/${code}`, { confirmation }, "DELETE");
      if (active.current) {
        let cleaned = false;
        try { cleaned = forgetDeletedRoom(localStorage, code); } catch { /* Browser storage may be unavailable. */ }
        onDeleted(cleaned);
      }
    } catch (reason) {
      if (active.current) setError(`${reason instanceof Error ? reason.message : "Could not finish deleting."} If deletion already started, the room stays unavailable while cleanup finishes. Retry to confirm completion.`);
    } finally { inFlight.current = false; if (active.current) setBusy(false); }
  }
  return <dialog className="panel delete-room-dialog" ref={dialog} aria-labelledby="delete-room-title"
    onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <h2 id="delete-room-title">Permanently delete room?</h2>
    <p><strong>{title}</strong></p>
    <p>This removes the EPUB, saved progress, highlights, comments and drawings for <strong>both you and your partner</strong>. It cannot be undone.</p>
    <p>Copies already downloaded to other devices cannot be erased remotely.</p>
    <label htmlFor="delete-room-confirmation">Type ВИДАЛИТИ to confirm</label>
    <input id="delete-room-confirmation" value={confirmation} disabled={busy} autoComplete="off" spellCheck={false} onChange={event => setConfirmation(event.target.value)} />
    {error && <p className="error" role="alert">{error}</p>}
    {busy && <p role="status">Deleting room…</p>}
    <div className="delete-room-actions"><button className="secondary" disabled={busy} onClick={onClose}>Cancel</button>
      <button className="danger" disabled={busy || confirmation !== "ВИДАЛИТИ"} onClick={() => void remove()}>{error ? "Retry deletion" : "Delete permanently"}</button></div>
  </dialog>;
}
