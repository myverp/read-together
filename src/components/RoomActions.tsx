"use client";
import { useEffect, useRef } from "react";
export default function RoomActions({ title, archived, disabled, onArchive }: {
  title: string; archived: boolean; disabled: boolean; onArchive: () => void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) menu.current?.removeAttribute("open"); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  function close() { menu.current?.removeAttribute("open"); trigger.current?.focus(); }
  return <details className="room-actions-menu" ref={menu} onKeyDown={event => {
    if (event.key === "Escape" && menu.current?.open) { event.preventDefault(); event.stopPropagation(); close(); }
  }}>
    <summary ref={trigger} aria-label={`Actions for ${title}`}>Actions</summary>
    <div className="room-actions-popover">
      <button className="text-button" disabled={disabled} aria-label={`${archived ? "Restore" : "Archive"} ${title}`} onClick={() => { close(); onArchive(); }}>{archived ? "Restore" : "Archive"}</button>
    </div>
  </details>;
}
