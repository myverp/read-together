"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { selectionToolbarPosition, type SelectionAnchor } from "@/lib/selection-anchor";
import ReaderIcon from "./ReaderIcon";

export default function SelectionActions({ anchor, onHighlight, onDismiss }: {
  anchor: SelectionAnchor; onHighlight: () => void; onDismiss: () => void;
}) {
  const toolbar = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const element = toolbar.current, area = element?.parentElement;
    if (!element || !area) return;
    const place = () => {
      const box = area.getBoundingClientRect(), viewport = window.visualViewport;
      const bounds = { left: Math.max(box.left, viewport?.offsetLeft ?? 0), right: Math.min(box.right, (viewport?.offsetLeft ?? 0) + (viewport?.width ?? innerWidth)),
        top: Math.max(box.top, viewport?.offsetTop ?? 0), bottom: Math.min(box.bottom, (viewport?.offsetTop ?? 0) + (viewport?.height ?? innerHeight)) };
      const next = selectionToolbarPosition(anchor, bounds, element.offsetWidth, element.offsetHeight);
      setPosition({ left: next.left - box.left, top: next.top - box.top });
    };
    place();
    const resize = new ResizeObserver(place); resize.observe(element); resize.observe(area);
    window.addEventListener("resize", place); window.visualViewport?.addEventListener("resize", place); window.visualViewport?.addEventListener("scroll", place);
    return () => { resize.disconnect(); window.removeEventListener("resize", place); window.visualViewport?.removeEventListener("resize", place); window.visualViewport?.removeEventListener("scroll", place); };
  }, [anchor]);
  return <div ref={toolbar} className="selection-actions" role="group" aria-label="Selected text actions" style={position || { visibility: "hidden" }} onPointerDown={event => event.preventDefault()}>
    <button aria-label="Highlight selection" title="Highlight selection" onClick={onHighlight}><ReaderIcon name="highlight" /></button>
    <button className="secondary" onClick={onDismiss} aria-label="Dismiss selection" title="Dismiss selection"><ReaderIcon name="close" /></button>
  </div>;
}
