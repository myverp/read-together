"use client";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

const KEY = "read-together:reading-tips:v1";
const tips = [
  { title: "Read at your own pace", text: "Turn pages here, or swipe across the book." },
  { title: "Keep a passage", text: "Select a phrase, then tap the highlighter to add a note." },
  { title: "Make yourself comfortable", text: "Open the menu for reading settings, search and Invite." },
];

export default function ReaderTips({ suspended, viewer, nextButton, menuButton }: {
  suspended: boolean; viewer: RefObject<HTMLDivElement | null>; nextButton: RefObject<HTMLButtonElement | null>; menuButton: RefObject<HTMLButtonElement | null>;
}) {
  const [step, setStep] = useState<number | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try { if (localStorage.getItem(KEY) === "done") return; } catch { /* Tips remain optional without storage. */ }
    setStep(0);
  }, []);
  useLayoutEffect(() => {
    if (step === null || suspended) return;
    const element = card.current;
    const anchor = step === 0 ? nextButton.current : step === 1 ? viewer.current : menuButton.current;
    if (!element || !anchor) return;
    const place = () => {
      const box = anchor.getBoundingClientRect(), viewport = window.visualViewport;
      const leftEdge = (viewport?.offsetLeft ?? 0) + 8, rightEdge = (viewport?.offsetLeft ?? 0) + (viewport?.width ?? innerWidth) - 8;
      const topEdge = (viewport?.offsetTop ?? 0) + 8, bottomEdge = (viewport?.offsetTop ?? 0) + (viewport?.height ?? innerHeight) - 8;
      const left = step === 0 || step === 1 ? box.right - element.offsetWidth : box.left;
      // Keep the first card above the book's lower edge: the drawings/return
      // row sits between the book and the footer and must stay tappable at 320px.
      const bookBottom = viewer.current?.getBoundingClientRect().bottom ?? box.top;
      const top = step === 0 ? Math.min(box.top, bookBottom) - element.offsetHeight - 10 : step === 1 ? box.top + 8 : box.bottom + 10;
      setPosition({ left: Math.max(leftEdge, Math.min(left, rightEdge - element.offsetWidth)), top: Math.max(topEdge, Math.min(top, bottomEdge - element.offsetHeight)) });
    };
    place(); const resize = new ResizeObserver(place); resize.observe(element); resize.observe(anchor);
    window.addEventListener("resize", place); window.visualViewport?.addEventListener("resize", place); window.visualViewport?.addEventListener("scroll", place);
    return () => { resize.disconnect(); window.removeEventListener("resize", place); window.visualViewport?.removeEventListener("resize", place); window.visualViewport?.removeEventListener("scroll", place); };
  }, [step, suspended, viewer, nextButton, menuButton]);
  function finish() {
    const restore = card.current?.contains(document.activeElement);
    try { localStorage.setItem(KEY, "done"); } catch { /* Dismiss for this reader session even if storage is unavailable. */ }
    setStep(null);
    const target = step === 0 && nextButton.current?.isConnected && !nextButton.current.disabled ? nextButton.current : menuButton.current;
    if (restore) target?.focus();
  }
  if (step === null || suspended) return null;
  return <div ref={card} className="reader-tip" role="region" aria-label="Reading tips" data-tip-step={step + 1} style={position || { visibility: "hidden" }} onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finish(); }
  }}>
    <div className="reader-tip-heading"><strong>{tips[step].title}</strong><span>{step + 1} / {tips.length}</span></div>
    <p>{tips[step].text}</p>
    <div className="reader-tip-actions"><button className="secondary" onClick={finish}>Skip tips</button><button onClick={() => {
      if (step === tips.length - 1) finish(); else { setPosition(null); setStep(step + 1); }
    }}>{step === tips.length - 1 ? "Done" : "Next tip"}</button></div>
  </div>;
}
