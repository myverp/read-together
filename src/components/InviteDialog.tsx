"use client";
import { useEffect, useRef, useState } from "react";
import { roomPath } from "@/lib/room-invitation";

export default function InviteDialog({ code, onClose }: { code: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    setUrl(`${location.origin}${roomPath(code)}`);
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); previous?.focus(); };
  }, [code]);
  async function copy() {
    try { await navigator.clipboard.writeText(url); setMessage("Link copied."); }
    catch { input.current?.focus(); input.current?.select(); setMessage("Copy the selected link manually using your browser’s copy command."); }
  }
  return <dialog className="panel invite-dialog" ref={dialog} aria-labelledby="invite-title" onCancel={onClose}>
    <h2 id="invite-title">Invite your reading partner</h2>
    <p>Anyone with this invitation can take the available second seat. Share it privately.</p>
    <label htmlFor="invite-url">Invitation link</label><input id="invite-url" ref={input} readOnly value={url} onFocus={event => event.target.select()} />
    <p>Room code: <strong className="code-input">{code}</strong></p>
    <button onClick={() => void copy()}>Copy link</button>
    <p role="status">{message}</p><button className="secondary" onClick={onClose}>Close invitation</button>
  </dialog>;
}
