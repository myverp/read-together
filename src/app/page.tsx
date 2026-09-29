"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { readerToken } from "@/lib/client";
import { createBookRoom, type BookCreation } from "@/lib/create-book-room";
import AccountPanel from "@/components/AccountPanel";
import { ROOM_CODE, invitationCode, requestRoomEntry, roomPath, takeExitWarning } from "@/lib/room-invitation";

export default function Home() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [exitWarning, setExitWarning] = useState("");
  const [demoCode, setDemoCode] = useState("");
  const uploadAttempt = useRef<BookCreation | null>(null);
  const demoAttempt = useRef<BookCreation | null>(null);
  const creation = useRef<AbortController | null>(null);
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    try {
      readerToken();
      setCode(localStorage.getItem("read-together:room") || "");
      setReady(true);
      setExitWarning(takeExitWarning());
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
    const normalized = invitationCode(code, location.origin);
    if (!normalized) { setError("Enter a 12-character room code or a valid invitation link from this site."); return; }
    setError(""); await enter(normalized);
  }

  return <main className="home">
    <header><h1>Read together</h1></header>
    <section className="panel demo-panel"><h2>Try reading together</h2><p>A short original story. No file or email needed.</p>
      <button disabled={!ready || !!busy} onClick={() => demoCode ? void enter(demoCode) : void create(true)}>{demoCode ? "Continue demo" : "Try demo"}</button>
      {demoCode && <button className="secondary" disabled={!!busy} onClick={() => { demoAttempt.current = null; void create(true); }}>Start another demo</button>}
    </section>
    <AccountPanel onOpenRoom={async roomCode => { setError(""); setBusy("Opening room…"); try { await enter(roomCode); } catch (e) { setError(e instanceof Error ? e.message : "Could not open room."); } finally { setBusy(""); } }} />
    <section className="panel"><h2>Start a room</h2>
      <label htmlFor="epub">Choose an EPUB</label>
      <input id="epub" type="file" accept=".epub,application/epub+zip" disabled={!ready || !!busy} onChange={e => setFile(e.target.files?.[0] || null)} />
      <p className="muted">DRM-free EPUB · up to 25 MB · upload once for both readers</p>
      <button disabled={!file || !!busy} onClick={() => void create()}>Upload & create room</button>
    </section>
    <form className="panel" onSubmit={e => { e.preventDefault(); void join(); }}><h2>Join a room</h2>
      <label htmlFor="code">Room code</label>
      <input id="code" className="code-input" placeholder="A1B2C3D4E5F6" value={code} maxLength={2048} autoCapitalize="characters" autoCorrect="off" spellCheck={false} disabled={!ready || !!busy} onChange={e => setCode(e.target.value)} />
      <button disabled={!code.trim() || !!busy}>Join / reopen room</button>
    </form>
    {exitWarning && <p className="error" role="alert">{exitWarning}</p>}
    {busy && <><p role="status">{busy}</p><button className="secondary" onClick={() => { creation.current?.abort(); setBusy("Cancelling… an active transfer may still finish."); }}>Cancel creation</button></>}{error && <p className="error" role="alert">{error}</p>}
  </main>;
}

