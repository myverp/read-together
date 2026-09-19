"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./client";
import type { Highlight, HighlightSnapshot } from "./highlights";

export function useHighlights(code: string) {
  const [snapshot, setSnapshot] = useState<HighlightSnapshot>({ revision: -1, items: [] });
  const [error, setError] = useState("");
  const active = useRef(true);
  const fetching = useRef(false);
  const endpoint = `/api/rooms/${code}/highlights`;
  const accept = useCallback((next: HighlightSnapshot) => {
    if (!active.current) return;
    setSnapshot(current => next.revision > current.revision ? next : current);
    setError("");
  }, []);
  const refresh = useCallback(async () => {
    if (document.visibilityState !== "visible" || !navigator.onLine || fetching.current) return;
    fetching.current = true;
    try { accept(await api<HighlightSnapshot>(endpoint, undefined, "GET")); }
    catch { if (active.current) setError("Highlights could not sync. Reconnecting automatically…"); }
    finally { fetching.current = false; }
  }, [accept, endpoint]);
  useEffect(() => {
    active.current = true;
    void refresh();
    // Broadcast handles live updates; this repairs missed messages after interruptions.
    const timer = setInterval(() => void refresh(), 15000);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active.current = false; clearInterval(timer);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [refresh]);
  async function save(input: Pick<Highlight, "id" | "cfi" | "quote" | "comment">) {
    const next = await api<HighlightSnapshot>(endpoint, input);
    accept(next);
  }
  async function remove(id: string) {
    const next = await api<HighlightSnapshot>(endpoint, { id }, "DELETE");
    accept(next);
  }
  return { highlights: snapshot.items, colors: snapshot.colors, error, refresh, save, remove };
}
