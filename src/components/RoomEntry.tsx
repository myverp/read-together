"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError, readerToken, supabase } from "@/lib/client";
import { rememberRoom, savedRooms } from "@/lib/room-history";
import { consumeRoomEntry, rememberExitWarning, requestRoomEntry, roomPath } from "@/lib/room-invitation";
import type { Room, RoomSummary } from "@/lib/types";
import AccountPanel from "./AccountPanel";

const Reader = dynamic(() => import("./Reader"), { ssr: false, loading: () => <p role="status">Opening reader…</p> });

export default function RoomEntry({ code }: { code: string }) {
  const router = useRouter();
  const [room, setRoom] = useState<Room | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [takeover, setTakeover] = useState(false);
  const [signIn, setSignIn] = useState(false);
  const active = useRef(false);
  const request = useRef<AbortController | null>(null);
  const explicit = useRef(false);

  const enter = useCallback(async (takeControl = false) => {
    if (!active.current || request.current) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError("");
    try {
      const next = await api<Room>(`/api/rooms/${code}`, takeControl ? { takeover: true } : undefined, "POST", { signal: controller.signal });
      if (!active.current || controller.signal.aborted) return;
      rememberRoom(localStorage, next); setTakeover(false); setRoom(next);
    } catch (reason) {
      if (!active.current || controller.signal.aborted) return;
      if (reason instanceof ApiError && reason.details?.takeoverRequired) {
        setTakeover(true); setError("This profile is open on another device. Choose Continue here to take control.");
      } else {
        if (reason instanceof ApiError && reason.status === 401) setSignIn(true);
        setError(reason instanceof Error ? reason.message : "Could not open this room. Try again.");
      }
    } finally {
      if (request.current === controller) { request.current = null; if (active.current) setBusy(false); }
    }
  }, [code]);

  useEffect(() => {
    active.current = true;
    let disposed = false;
    let currentUser: string | null | undefined;
    explicit.current = consumeRoomEntry(code) || explicit.current;
    async function reopen() {
      try {
        readerToken();
        if (explicit.current || savedRooms(localStorage).some(saved => saved.code === code)) { if (!disposed) await enter(); return; }
        const { data } = await supabase().auth.getSession();
        if (data.session) {
          const profile = await api<{ rooms: RoomSummary[] }>("/api/profile", undefined, "GET");
          if (!disposed && profile.rooms.some(saved => saved.code === code)) { await enter(); return; }
        }
      } catch (reason) { if (!disposed) setError(reason instanceof Error ? reason.message : "Could not check your saved rooms."); }
      if (!disposed) setBusy(false);
    }
    void reopen();
    const { data } = supabase().auth.onAuthStateChange((event, session) => {
      const nextUser = session?.user.id ?? null;
      if (event === "SIGNED_IN" && currentUser !== undefined && nextUser !== currentUser) { setRoom(null); void reopen(); }
      if (event === "SIGNED_OUT") { request.current?.abort(); request.current = null; setRoom(null); setTakeover(false); setBusy(false); }
      currentUser = nextUser;
    });
    return () => { disposed = true; active.current = false; request.current?.abort(); request.current = null; data.subscription.unsubscribe(); };
  }, [code, enter]);

  if (room) return <Reader key={`${room.code}:${room.seat}:${room.controlVersion}`} room={room} onExit={warning => { rememberExitWarning(warning); setRoom(null); router.push("/"); }} />;
  return <main className="home room-entry">
    <header><Link href="/">Read together</Link><h1>You’re invited to read</h1></header>
    <section className="panel"><h2>Join this room</h2><p>Anyone with this invitation can take the available second seat.</p>
      <p className="muted">Already a reader? Use your original browser or sign in to your linked profile.</p>
      <button disabled={busy} onClick={() => void enter(takeover)}>{takeover ? "Continue here" : "Join room"}</button>
      {busy && <p role="status">Opening room…</p>}{error && <p className="error" role="alert">{error}</p>}
    </section>
    <button className="secondary" aria-expanded={signIn} onClick={() => setSignIn(value => !value)}>Sign in to your profile</button>
    {signIn && <AccountPanel initiallyOpen onOpenRoom={async next => { if (next === code) await enter(); else { requestRoomEntry(next); router.push(roomPath(next)); } }} />}
  </main>;
}
