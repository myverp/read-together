"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, supabase } from "./client";
import { EMPTY_POSITION, isPosition, type Position, type Room } from "./types";
import { createPresenceConnection } from "./presence-connection";

function restore(key: string): Position {
  try { const saved = JSON.parse(localStorage.getItem(key) || "null"); return isPosition(saved) ? saved : EMPTY_POSITION; }
  catch { return EMPTY_POSITION; }
}
type StateSnapshot = { active: boolean; controlVersion: number; me: Position; partner: Position };

export function useRoom(room: Room, onHighlightsChanged?: () => void) {
  const key = `read-together:${room.code}:${room.seat}`;
  const authenticated = (room.controlVersion ?? 0) > 0;
  const initialMe = authenticated && isPosition(room.me) ? room.me : restore(key);
  const [me, setMe] = useState<Position>(initialMe);
  const [partner, setPartner] = useState<Position>(() => isPosition(room.partner) ? room.partner : restore(`${key}:partner`));
  const [online, setOnline] = useState(false);
  const [connection, setConnection] = useState("Connecting…");
  const [storageError, setStorageError] = useState("");
  const [takenOver, setTakenOver] = useState(false);
  const latest = useRef(me); const controlVersion = useRef(room.controlVersion ?? 0);
  const onlineRef = useRef(false);
  const session = useRef<ReturnType<typeof createPresenceConnection> | null>(null);
  const removal = useRef<Promise<void>>(Promise.resolve());
  const highlightsChanged = useRef(onHighlightsChanged); highlightsChanged.current = onHighlightsChanged;
  const generation = useRef(0); const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef<Position | null>(null); const writing = useRef(false);

  const loseControl = useCallback(() => {
    if (generation.current < 0) return;
    generation.current = -1; dirty.current = null; setTakenOver(true); onlineRef.current = false; setOnline(false); setConnection("Continued on another device");
    if (writeTimer.current) clearTimeout(writeTimer.current);
    const current = session.current; session.current = null; if (current) void current.stop();
  }, []);
  const notifyHighlights = useCallback(() => { if (generation.current >= 0) session.current?.notifyHighlights(); }, []);

  const persist = useCallback(async () => {
    if (!authenticated || generation.current < 0 || writing.current || !navigator.onLine) return;
    const position = dirty.current; if (!position) return;
    dirty.current = null; writing.current = true;
    const expectedGeneration = generation.current;
    try {
      await api(`/api/rooms/${room.code}/state`, { position, controlVersion: controlVersion.current }, "PATCH");
      setStorageError("");
    } catch (error) {
      if (expectedGeneration !== generation.current) return;
      const details = (error as Error & { details?: { takenOver?: boolean } }).details;
      if (details?.takenOver) loseControl(); else { dirty.current = latest.current; setStorageError("Progress could not sync. It is still saved on this device."); }
    } finally {
      writing.current = false;
      if (dirty.current && expectedGeneration === generation.current && navigator.onLine) void persist();
    }
  }, [authenticated, loseControl, room.code]);

  const update = useCallback((next: Position) => {
    if (generation.current < 0) return;
    latest.current = next; setMe(next);
    try { localStorage.setItem(key, JSON.stringify(next)); }
    catch { setStorageError("Browser storage is full or unavailable. Your position cannot be saved on this device."); }
    if (authenticated) {
      dirty.current = next;
      if (writeTimer.current) clearTimeout(writeTimer.current);
      writeTimer.current = setTimeout(() => void persist(), 250);
    }
  }, [key, persist]);

  const flushProgress = useCallback(async () => {
    if (writeTimer.current) { clearTimeout(writeTimer.current); writeTimer.current = null; }
    await persist();
    while (writing.current) await new Promise(resolve => setTimeout(resolve, 10));
    if (dirty.current) await persist();
  }, [persist]);

  useEffect(() => {
    const client = supabase();
    const currentConnection = createPresenceConnection({
      createChannel: () => client.channel(`reading:${room.topic}`, { config: { presence: { key: String(room.seat) } } }),
      removeChannel: current => client.removeChannel(current), previousRemoval: removal.current,
      getPosition: () => latest.current, isOnline: () => navigator.onLine && generation.current >= 0,
      onStatus: status => { if (generation.current >= 0) setConnection(status); }, onUnavailable: () => { onlineRef.current = false; setOnline(false); },
      onHighlightsChanged: () => highlightsChanged.current?.(),
      onSync: current => {
        if (generation.current < 0) return;
        const entries = current.presenceState<Position>()[String(room.seat === 1 ? 2 : 1)] || [];
        const position = entries.find(isPosition); onlineRef.current = !!position; setOnline(!!position);
        if (position) { setPartner(position); try { localStorage.setItem(`${key}:partner`, JSON.stringify(position)); } catch { /* optional cache */ } }
      },
    });
    session.current = currentConnection;
    const reconnect = () => { if (document.visibilityState === "visible" && navigator.onLine && generation.current >= 0) currentConnection.reconnect(); };
    window.addEventListener("online", reconnect); window.addEventListener("offline", currentConnection.offline); document.addEventListener("visibilitychange", reconnect);
    return () => {
      if (writeTimer.current) clearTimeout(writeTimer.current);
      window.removeEventListener("online", reconnect); window.removeEventListener("offline", currentConnection.offline); document.removeEventListener("visibilitychange", reconnect);
      session.current = null; removal.current = currentConnection.stop();
    };
  }, [room.topic, room.seat, key]);
  useEffect(() => { if (!takenOver) session.current?.publish(); }, [me, takenOver]);

  useEffect(() => {
    let disposed = false; let running = false;
    const poll = async () => {
      if (disposed || running || document.visibilityState !== "visible" || !navigator.onLine || generation.current < 0) return;
      running = true; const expected = generation.current;
      try {
        const state = await api<StateSnapshot>(`/api/rooms/${room.code}/state`, undefined, "GET");
        if (disposed || expected !== generation.current) return;
        controlVersion.current = state.controlVersion;
        if (!state.active) { loseControl(); return; }
        if (!onlineRef.current && isPosition(state.partner)) { setPartner(state.partner); try { localStorage.setItem(`${key}:partner`, JSON.stringify(state.partner)); } catch { /* optional cache */ } }
        if (dirty.current) void persist();
      } catch { /* Presence and the next poll can recover. */ }
      finally { running = false; }
    };
    void poll(); const timer = setInterval(() => void poll(), 5000);
    window.addEventListener("focus", poll); document.addEventListener("visibilitychange", poll);
    return () => { disposed = true; clearInterval(timer); window.removeEventListener("focus", poll); document.removeEventListener("visibilitychange", poll); };
  }, [authenticated, key, loseControl, persist, room.code]);

  useEffect(() => {
    if (!authenticated) return;
    const flush = () => { if (document.visibilityState === "hidden") void flushProgress(); };
    document.addEventListener("visibilitychange", flush); window.addEventListener("pagehide", flush);
    return () => { document.removeEventListener("visibilitychange", flush); window.removeEventListener("pagehide", flush); };
  }, [authenticated, flushProgress]);

  return { me, partner, online, connection, storageError, update, notifyHighlights, takenOver, flushProgress };
}
