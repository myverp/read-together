"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { readerToken } from "@/lib/client";
import { createBookRoom, type BookCreation } from "@/lib/create-book-room";
import AccountPanel from "@/components/AccountPanel";
import { lastRoom } from "@/lib/room-history";
import { ROOM_CODE, invitationCode, requestRoomEntry, roomPath, takeExitWarning } from "@/lib/room-invitation";

export default function Home() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [errorArea, setErrorArea] = useState("storage");
  const [recent, setRecent] = useState<{ code: string; title?: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const inviteInput = useRef<HTMLInputElement>(null);
  const [ready, setReady] = useState(false);
  const [exitWarning, setExitWarning] = useState("");
  const [demoCode, setDemoCode] = useState("");
  const uploadAttempt = useRef<BookCreation | null>(null);
  const demoAttempt = useRef<BookCreation | null>(null);
  const creation = useRef<AbortController | null>(null);
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    setExitWarning(takeExitWarning());
    try {
      readerToken();
      setRecent(lastRoom(localStorage));
      setReady(true);
      const demo = localStorage.getItem("read-together:demo") || "";
      if (ROOM_CODE.test(demo)) setDemoCode(demo);
    } catch { setError("Enable browser storage to remember your reader seat."); }
    return () => { active.current = false; creation.current?.abort(); };
  }, []);

  async function enter(roomCode: string) {
    requestRoomEntry(roomCode);
    router.push(roomPath(roomCode));
  }

  async function create(demo = false) {
    if (creation.current || (!demo && !file)) return;
    const controller = new AbortController(); creation.current = controller;
    setErrorArea(demo ? "demo" : "upload");
    setError(""); setBusy(demo ? "Loading demo…" : "Checking EPUB…");
    try {
      if (demo && !demoAttempt.current) {
        const response = await fetch("/demo/read-together-demo.epub", { signal: controller.signal });
        if (!response.ok) throw new Error("Could not load the demo. Try again.");
        demoAttempt.current = { file: new File([await response.blob()], "The Space Between Pages.epub", { type: "application/epub+zip" }) };
      }
      if (!demo && uploadAttempt.current?.file !== file) uploadAttempt.current = { file: file! };
      const attempt = demo ? demoAttempt.current! : uploadAttempt.current!;
      const next = await createBookRoom(attempt, message => { if (active.current) setBusy(message); }, controller.signal);
      if (!active.current) return;
      if (demo) { try { localStorage.setItem("read-together:demo", next); } catch { /* Admission remains possible. */ } setDemoCode(next); }
      await enter(next);
    } catch (reason) {
      if (active.current) setError(controller.signal.aborted ? "Creation cancelled. An unfinished room will be cleaned up later. You can retry here." : reason instanceof Error ? reason.message : "Could not open this EPUB.");
    } finally {
      if (creation.current === controller) creation.current = null;
      if (active.current) setBusy("");
    }
  }

  async function join() {
    if (creation.current) return;
    setErrorArea("invite");
    const normalized = invitationCode(code, location.origin);
    if (!normalized) { setError("Enter a 12-character room code or a valid invitation link from this site."); return; }
    setError(""); await enter(normalized);
  }

  return <main className="home">
    <header className="home-intro"><h1>Read together</h1><p className="home-tagline">One EPUB. Two readers, each at their own pace.</p>
      <div className="home-actions">
        <button disabled={!ready || !!busy} onClick={() => demoCode ? void enter(demoCode) : void create(true)}>{demoCode ? "Continue demo" : "Try demo"}</button>
        <button className="secondary" disabled={!ready || !!busy} onClick={() => { fileInput.current?.scrollIntoView({ block: "center" }); fileInput.current?.focus(); fileInput.current?.click(); }}>Open your EPUB</button>
      </div>
      <p className="muted">Try a short original story, then invite someone to read with you.</p>
      <button className="text-button invitation-action" disabled={!!busy} onClick={() => { inviteInput.current?.scrollIntoView({ block: "center" }); inviteInput.current?.focus(); }}>Have an invitation?</button>
      {demoCode && <button className="text-button" disabled={!!busy} onClick={() => { demoAttempt.current = null; void create(true); }}>Start another demo</button>}
      {error && errorArea === "demo" && <p className="error" role="alert">{error}</p>}
    </header>
    {recent && <section className="panel continue-panel"><div><h2>Continue reading</h2><p>{recent.title || "Your last room on this browser"}</p></div><button className="secondary" disabled={!!busy} onClick={() => void enter(recent.code)}>Continue reading</button></section>}
    {exitWarning && <p className="error" role="alert">{exitWarning}</p>}
    {error && errorArea === "storage" && <p className="error" role="alert">{error}</p>}
    {busy && <section className="panel creation-status"><p role="status">{busy}</p><button className="secondary" onClick={() => { creation.current?.abort(); setBusy("Cancelling… an active transfer may still finish."); }}>Cancel creation</button></section>}
    <form className="panel" onSubmit={event => { event.preventDefault(); void create(); }}><h2>Open your own book</h2>
      <p className="muted" id="epub-limits">DRM-free EPUB · up to 25 MB · upload once for both readers. PDF and protected books are not supported.</p>
      <label htmlFor="epub">Choose an EPUB</label>
      <input id="epub" ref={fileInput} aria-describedby="epub-limits" type="file" accept=".epub,application/epub+zip" disabled={!ready || !!busy} onChange={e => { setFile(e.target.files?.[0] || null); setError(""); }} />
      <button disabled={!file || !!busy}>Upload & create room</button>
      {error && errorArea === "upload" && <p className="error" role="alert">{error}</p>}
    </form>
    <form className="panel" onSubmit={e => { e.preventDefault(); void join(); }}><h2>Have an invitation?</h2>
      <label htmlFor="code">Room code or invitation link</label>
      <input id="code" ref={inviteInput} placeholder="A1B2C3D4E5F6 or invitation link" value={code} maxLength={2048} autoCapitalize="off" autoCorrect="off" spellCheck={false} disabled={!ready || !!busy} onChange={e => setCode(e.target.value)} />
      <button disabled={!code.trim() || !!busy}>Join / reopen room</button>
      {error && errorArea === "invite" && <p className="error" role="alert">{error}</p>}
    </form>
    <AccountPanel onOpenRoom={async roomCode => { await enter(roomCode); }} />
  </main>;
}
