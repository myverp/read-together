"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { api, readerToken, supabase } from "@/lib/client";
import { MAX_EPUB_BYTES, type Room } from "@/lib/types";
import AccountPanel from "@/components/AccountPanel";
const Reader = dynamic(() => import("@/components/Reader"), { ssr: false, loading: () => <p>Opening reader…</p> });

export default function Home() {
  const [room, setRoom] = useState<Room | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [takeoverCode, setTakeoverCode] = useState("");
  useEffect(() => {
    try {
      readerToken();
      setCode(localStorage.getItem("read-together:room") || "");
      setReady(true);
    } catch { setError("Enable browser storage to remember your reader seat."); }
  }, []);

  function remember(next: Room) {
    const saved = JSON.parse(localStorage.getItem("read-together:rooms") || "[]") as { code: string; seat: 1 | 2 }[];
    localStorage.setItem("read-together:rooms", JSON.stringify([{ code: next.code, seat: next.seat }, ...saved.filter(room => room.code !== next.code)].slice(0, 50)));
  }
  async function enter(roomCode: string, takeover = false) {
    let next: Room;
    try { next = await api<Room>(`/api/rooms/${roomCode}`, takeover ? { takeover: true } : undefined); }
    catch (error) {
      const details = (error as Error & { details?: { takeoverRequired?: boolean } }).details;
      if (details?.takeoverRequired) { setTakeoverCode(roomCode); throw new Error("This profile is open on another device. Choose Continue here to take control."); }
      throw error;
    }
    localStorage.setItem("read-together:room", roomCode);
    remember(next); setTakeoverCode("");
    setCode(roomCode);
    setRoom(next);
  }

  async function create() {
    if (!file) return;
    setError(""); setBusy("Checking EPUB…");
    try {
      if (!file.name.toLowerCase().endsWith(".epub") || file.size > MAX_EPUB_BYTES || !file.size) throw new Error("Choose an EPUB file up to 25 MB.");
      // Parse before uploading, so broken/DRM-protected books do not consume a room.
      const { default: ePub } = await import("epubjs");
      const book = ePub();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          book.open(await file.arrayBuffer(), "binary").then(() => Promise.all([book.opened, book.ready])),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("EPUB could not be opened. Use a DRM-free EPUB.")), 15000); }),
        ]);
      } finally { clearTimeout(timer); book.destroy(); }
      setBusy("Uploading EPUB…");
      const upload = await api<{ code: string; path: string; uploadToken: string }>("/api/rooms", { name: file.name, size: file.size });
      const { error: uploadError } = await supabase().storage.from("epubs").uploadToSignedUrl(upload.path, upload.uploadToken, file, { contentType: "application/epub+zip" });
      if (uploadError) throw uploadError;
      await enter(upload.code);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not open this EPUB."); }
    finally { setBusy(""); }
  }

  async function join() {
    setError(""); setBusy("Joining room…");
    try { await enter(code); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not join room."); }
    finally { setBusy(""); }
  }

  if (room) return <Reader room={room} onExit={() => setRoom(null)} />;
  return <main className="home">
    <header><h1>Read together</h1></header>
    <AccountPanel onOpenRoom={async roomCode => { setError(""); setBusy("Opening room…"); try { await enter(roomCode); } catch (e) { setError(e instanceof Error ? e.message : "Could not open room."); } finally { setBusy(""); } }} />
    <section className="panel"><h2>Start a room</h2>
      <label htmlFor="epub">Choose an EPUB</label>
      <input id="epub" type="file" accept=".epub,application/epub+zip" disabled={!ready || !!busy} onChange={e => setFile(e.target.files?.[0] || null)} />
      <p className="muted">DRM-free EPUB · up to 25 MB · upload once for both readers</p>
      <button disabled={!file || !!busy} onClick={create}>Upload & create room</button>
    </section>
    <form className="panel" onSubmit={e => { e.preventDefault(); void join(); }}><h2>Join a room</h2>
      <label htmlFor="code">Room code</label>
      <input id="code" className="code-input" placeholder="A1B2C3D4E5F6" value={code} maxLength={12} autoCapitalize="characters" autoCorrect="off" spellCheck={false} disabled={!ready || !!busy} onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-F0-9]/g, ""))} />
      <button disabled={code.length !== 12 || !!busy}>Join / reopen room</button>
    </form>
    {takeoverCode && <section className="takeover-card" role="alert"><p>This profile is reading this room elsewhere.</p><button onClick={() => void enter(takeoverCode, true)}>Continue here</button></section>}
    {busy && <p role="status">{busy}</p>}{error && <p className="error" role="alert">{error}</p>}
  </main>;
}

