"use client";
import { useEffect, useRef, useState } from "react";
import type { BookMatch } from "@/lib/book-search";
import ReaderIcon from "./ReaderIcon";

export default function ReaderSearch({ onSearch, onNavigate, onClose, busy, navigationError }: {
  onSearch: (query: string, signal: AbortSignal, progress: (count: number, total: number) => void) => Promise<{ items: BookMatch[]; limited: boolean; failed: number }>;
  onNavigate: (cfi: string) => Promise<boolean>; onClose: () => void; busy: boolean; navigationError: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const request = useRef<AbortController | null>(null);
  const [query, setQuery] = useState(""), [working, setWorking] = useState(false), [status, setStatus] = useState("");
  const [result, setResult] = useState<Awaited<ReturnType<typeof onSearch>> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null, element = dialog.current;
    element?.showModal(); heading.current?.focus();
    return () => { request.current?.abort(); request.current = null; element?.close(); previous?.focus(); };
  }, []);
  function cancel() { request.current?.abort(); request.current = null; setWorking(false); setStatus("Search cancelled."); }
  async function submit() {
    if (working || busy || query.trim().length < 2) return;
    const controller = new AbortController(); request.current = controller;
    setWorking(true); setResult(null); setError(""); setStatus("Searching book…");
    try {
      const next = await onSearch(query.trim(), controller.signal, (count, total) => { if (!controller.signal.aborted) setStatus(`Searching section ${count} of ${total}…`); });
      if (!controller.signal.aborted) { setResult(next); setStatus(`${next.items.length} results${next.limited ? " (first 200; refine your search)" : ""}.`); }
    } catch { if (!controller.signal.aborted) { setError("Could not search this book. Try again."); setStatus(""); } }
    finally { if (request.current === controller) { request.current = null; setWorking(false); } }
  }
  return <dialog ref={dialog} className="panel reader-dialog search-dialog" aria-labelledby="search-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="notes-heading"><h2 id="search-title" tabIndex={-1} ref={heading}>Search book</h2><button className="secondary search-close" aria-label="Close search" title="Close search" disabled={busy} onClick={onClose}>×</button></div>
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <label htmlFor="book-query">Find in book</label><div className="search-query-row"><input id="book-query" type="search" maxLength={200} value={query} disabled={working || busy} onChange={event => { setQuery(event.target.value); setResult(null); setStatus(""); }} placeholder="Word or phrase (at least 2 characters)" />
      <button aria-label="Search" title="Search" disabled={working || busy || query.trim().length < 2}><ReaderIcon name="search" /></button></div>
      {working && <button type="button" className="secondary" onClick={cancel}>Cancel search</button>}
    </form>
    <p role="status">{busy ? "Opening result…" : status}</p>
    {result?.failed ? <p role="alert">{result.failed} sections could not be searched. Results may be incomplete. Search again to retry.</p> : null}
    {result && !result.items.length && <p>No matches found in the searched sections.</p>}
    {(error || navigationError) && <p className="error" role="alert">{error || navigationError}</p>}
    <ol className="search-results">{result?.items.map((item, index) => <li key={`${item.cfi}-${index}`}><button className="secondary" disabled={busy} onClick={() => { void onNavigate(item.cfi).then(ok => { if (ok) onClose(); }); }}><strong>{item.section}</strong><span>{item.excerpt}</span></button></li>)}</ol>
  </dialog>;
}
