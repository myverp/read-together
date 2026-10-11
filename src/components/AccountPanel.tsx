"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { api, supabase } from "@/lib/client";
import { AVATARS, EMPTY_POSITION, isPosition, type Avatar, type Profile, type RoomSummary } from "@/lib/types";
import { HIGHLIGHT_COLORS } from "@/lib/highlights";
import { savedRooms } from "@/lib/room-history";

const AVATAR_LABELS: Record<Avatar, string> = { book: "📖", leaf: "🌿", moon: "🌙", star: "★", tea: "☕" };

export default function AccountPanel({ onOpenRoom, initiallyOpen = false }: { onOpenRoom: (code: string) => Promise<void>; initiallyOpen?: boolean }) {
  const [signInOpen, setSignInOpen] = useState(initiallyOpen);
  const pending = useRef(false);
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState(""); const [code, setCode] = useState("");
  const [sent, setSent] = useState(false); const [busy, setBusy] = useState(""); const [message, setMessage] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null); const [rooms, setRooms] = useState<RoomSummary[]>([]);

  const refresh = useCallback(async () => {
    try { const data = await api<{ profile: Profile; rooms: RoomSummary[] }>("/api/profile", undefined, "GET"); setProfile(data.profile); setRooms(data.rooms); setMessage(""); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not load profile."); }
  }, []);
  useEffect(() => {
    void supabase().auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase().auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => { if (session) void refresh(); else { setProfile(null); setRooms([]); } }, [session, refresh]);

  async function requestCode() {
    if (pending.current) return; pending.current = true;
    setBusy("Sending code…"); setMessage("");
    try {
      const { error } = await supabase().auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
      if (error) throw error; setSent(true);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not send the code. Try again."); }
    finally { pending.current = false; setBusy(""); }
  }
  async function verifyCode() {
    if (pending.current) return; pending.current = true;
    setBusy("Signing in…"); setMessage("");
    try {
      const { error } = await supabase().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
      if (error) throw error; setSent(false); setCode("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not sign in. Try again."); }
    finally { pending.current = false; setBusy(""); }
  }
  async function saveProfile() {
    if (!profile) return; setBusy("Saving profile…");
    try { const data = await api<{ profile: Profile }>("/api/profile", profile, "PATCH"); setProfile(data.profile); setMessage("Profile saved."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not save profile."); }
    finally { setBusy(""); }
  }
  async function linkRooms() {
    setBusy("Linking rooms…");
    try {
      const saved = savedRooms(localStorage);
      const entries = saved.map(room => {
        let position = EMPTY_POSITION;
        try { const value = JSON.parse(localStorage.getItem(`read-together:${room.code}:${room.seat}`) || "null"); if (isPosition(value)) position = value; } catch { /* Keep empty position. */ }
        return { code: room.code, position };
      });
      const result = await api<{ linked: string[]; skipped: { code: string; reason: string }[] }>("/api/profile/link", { rooms: entries });
      await refresh();
      setMessage(`${result.linked.length} room${result.linked.length === 1 ? "" : "s"} linked${result.skipped.length ? `; ${result.skipped.length} skipped safely` : ""}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not link rooms."); }
    finally { setBusy(""); }
  }

  if (!session && !signInOpen) return <button className="secondary account-toggle" onClick={() => setSignInOpen(true)}>Sign in</button>;
  if (session && !profile) return <section className="panel account-panel"><p role="status">Loading your profile…</p>{message && <><p className="error" role="alert">{message}</p><button onClick={() => void refresh()}>Retry profile</button></>}</section>;
  if (!session) return <section className="panel account-panel"><h2>Read on any device</h2>
    <p className="muted">Optional. Email codes let your profile reopen linked rooms.</p>
    <form onSubmit={event => { event.preventDefault(); if (sent ? code.length === 8 : email.includes("@")) void (sent ? verifyCode() : requestCode()); }}>
    <label htmlFor="account-email">Email</label><input id="account-email" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} disabled={!!busy || sent} />
    {!sent ? <button disabled={!email.includes("@") || !!busy}>{busy || "Email me a code"}</button> : <>
      <label htmlFor="account-code">8-digit code</label><input id="account-code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ""))} />
      <button disabled={code.length !== 8 || !!busy}>{busy || "Sign in"}</button>
      <button type="button" className="text-button" disabled={!!busy} onClick={() => { setSent(false); setCode(""); setMessage(""); }}>Use another email</button>
    </>}</form>{message && <p className="error" role="alert">{message}</p>}
  </section>;

  if (!profile) return null;
  return <section className="panel account-panel"><div className="panel-title"><h2>Your profile</h2><button className="text-button" onClick={() => void supabase().auth.signOut()}>Sign out</button></div>
    <label htmlFor="profile-name">Name</label><input id="profile-name" maxLength={40} value={profile.name} onChange={event => setProfile({ ...profile, name: event.target.value })} />
    <fieldset><legend>Avatar</legend><div className="choice-row">{AVATARS.map(avatar => <button type="button" key={avatar} className={profile.avatar === avatar ? "choice selected" : "choice"} aria-label={avatar} aria-pressed={profile.avatar === avatar} onClick={() => setProfile({ ...profile, avatar })}>{AVATAR_LABELS[avatar]}</button>)}</div></fieldset>
    <fieldset><legend>Default highlight color</legend><div className="color-row">{HIGHLIGHT_COLORS.map((color, index) => <button type="button" key={color} className={profile.preferredColor === index ? "color-choice selected" : "color-choice"} style={{ backgroundColor: color }} aria-label={`Color ${index + 1}`} aria-pressed={profile.preferredColor === index} onClick={() => setProfile({ ...profile, preferredColor: index })} />)}</div></fieldset>
    <button disabled={!!busy || !profile.name.trim()} onClick={() => void saveProfile()}>{busy || "Save profile"}</button>
    <button className="secondary link-rooms" disabled={!!busy} onClick={() => void linkRooms()}>Link browser rooms</button>
    <p className="muted">Want these guest rooms on another device? Link them explicitly to this profile. Signing in alone keeps them on this browser.</p>
    {message && <p className={message.includes("saved") || message.includes("linked") ? "success" : "error"} role="status">{message}</p>}
    {!!rooms.length && <div className="my-rooms"><h3>My rooms</h3>{rooms.map(room => <button className="room-row secondary" key={room.code} onClick={() => void onOpenRoom(room.code)}><span>{room.title}</span><small>{room.code}</small></button>)}</div>}
  </section>;
}
