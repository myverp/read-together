"use client";
import { useEffect, useRef, type ReactNode } from "react";

export default function ReaderRoomDetails({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); previous?.focus(); };
  }, []);
  return <dialog ref={dialog} className="panel reader-dialog room-details-dialog" aria-labelledby="room-details-title" onCancel={onClose}>
    <h2 id="room-details-title">Room details</h2>
    {children}
    <button className="secondary" onClick={onClose}>Close room details</button>
  </dialog>;
}
