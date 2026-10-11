"use client";
import { useEffect, useRef, useState, type RefObject } from "react";
import ReaderIcon, { type ReaderIconName } from "./ReaderIcon";

export default function ReaderMenu({ items, trigger, onOpenChange }: {
  items: { label: string; icon: ReaderIconName; disabled?: boolean; onSelect: () => void }[];
  trigger: RefObject<HTMLButtonElement | null>;
  onOpenChange: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const changeOpen = (value: boolean) => { setOpen(value); onOpenChange(value); };
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) { setOpen(false); onOpenChange(false); }
    };
    document.addEventListener("pointerdown", outside);
    // Pointer events in the EPUB iframe do not bubble to the parent document.
    // Reflow/rotation can replace the iframe while this menu remains open.
    const bookDocuments = new Set<Document>();
    const bookFrames = new Set<HTMLIFrameElement>();
    const bindBookDocuments = () => {
      document.querySelectorAll<HTMLIFrameElement>(".book-view iframe").forEach(frame => {
        if (!bookFrames.has(frame)) {
          bookFrames.add(frame);
          frame.addEventListener("load", bindBookDocuments);
        }
        const doc = frame.contentDocument;
        if (doc && !bookDocuments.has(doc)) {
          bookDocuments.add(doc);
          doc.addEventListener("pointerdown", outside);
        }
      });
    };
    bindBookDocuments();
    const bookView = document.querySelector(".book-view");
    const observer = new MutationObserver(bindBookDocuments);
    if (bookView) observer.observe(bookView, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      document.removeEventListener("pointerdown", outside);
      bookFrames.forEach(frame => frame.removeEventListener("load", bindBookDocuments));
      bookDocuments.forEach(doc => doc.removeEventListener("pointerdown", outside));
    };
  }, [open, onOpenChange]);
  return <div className="reader-menu-anchor" ref={root} onBlur={event => {
    if (open && event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) changeOpen(false);
  }}>
    <button ref={trigger} className="secondary reader-icon-button" aria-label="Reader menu" title="Reader menu" aria-expanded={open} aria-controls="reader-menu" aria-haspopup="menu"
      onClick={() => changeOpen(!open)} onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); changeOpen(true); }
      }}><ReaderIcon name="menu" /></button>
    {open && <div ref={menu} id="reader-menu" className="reader-menu" role="menu" aria-label="Reader actions" onKeyDown={event => {
      const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); changeOpen(false); trigger.current?.focus(); }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }
      if (event.key === "Tab") { changeOpen(false); trigger.current?.focus(); }
    }}>
      {items.map((item, index) => <div key={item.label} role="none">
        {index === 3 && <div className="reader-menu-separator" role="separator" />}
        <button role="menuitem" tabIndex={-1} className="secondary" disabled={item.disabled} onClick={() => {
          changeOpen(false); trigger.current?.focus(); item.onSelect();
        }}><ReaderIcon name={item.icon} /><span>{item.label}</span></button>
      </div>)}
    </div>}
  </div>;
}
