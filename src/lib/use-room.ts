"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, supabase } from "./client";
import { isPosition, type Position, type Room } from "./types";
import { createPresenceConnection } from "./presence-connection";
import { browserStorage, clearPending, readPending, readPosition, saveProgress, samePosition, type PendingProgress } from "./local-progress";
import { createProgressQueue, type SyncState } from "./progress-queue";

type StateSnapshot = { active: boolean; controlVersion: number; revision: number; me: Position; partner: Position };
export function useRoom(room: Room, onHighlightsChanged?: () => void) {
  const key = `read-together:${room.code}:${room.seat}`;
  const authenticated = (room.controlVersion ?? 0) > 0;
  const [initialPending] = useState(() => authenticated ? readPending(browserStorage(), key) : null);
  const restorable = initialPending?.controlVersion === room.controlVersion ? initialPending : null;
  const [stalePending, setStalePending] = useState<PendingProgress | null>(initialPending && !restorable ? initialPending : null);
  const [me, setMe] = useState<Position>(() => restorable?.position ?? (authenticated && isPosition(room.me) ? room.me : readPosition(browserStorage(), key)));
  const [partner, setPartner] = useState<Position>(() => isPosition(room.partner) ? room.partner : readPosition(browserStorage(), `${key}:partner`));
  const [online, setOnline] = useState(false);
  const [connection, setConnection] = useState("Connecting…");
  const [storageError, setStorageError] = useState("Checking device storage…");
  const [syncState, setSyncState] = useState<SyncState>(restorable ? "Syncing…" : "Synced");
  const [takenOver, setTakenOver] = useState(false);
  const latest = useRef(me), localSaved = useRef(false), cloudSaved = useRef(authenticated && !restorable);
  const onlineRef = useRef(false), alive = useRef(true);
  const session = useRef<ReturnType<typeof createPresenceConnection> | null>(null);
  const removal = useRef<Promise<void>>(Promise.resolve());
  const queue = useRef<ReturnType<typeof createProgressQueue> | null>(null);
  const highlightsChanged = useRef(onHighlightsChanged); highlightsChanged.current = onHighlightsChanged;
  const loseControl = useCallback(() => {
    if (!alive.current) return;
    queue.current?.stop(); setTakenOver(true); onlineRef.current = false; setOnline(false); setConnection("Continued on another device");
    const current = session.current; session.current = null; if (current) void current.stop();
  }, []);
  const notifyHighlights = useCallback(() => { if (alive.current && !takenOver) session.current?.notifyHighlights(); }, [takenOver]);
  const recordLocal = useCallback((position: Position, pending?: PendingProgress) => {
    localSaved.current = saveProgress(browserStorage(), key, position, pending);
    setStorageError(localSaved.current ? "" : "Browser storage is full or unavailable. Your position cannot be saved on this device.");
  }, [key]);

  useEffect(() => {
    alive.current = true;
    recordLocal(latest.current, restorable ?? undefined);
    if (!authenticated) return () => { alive.current = false; };
    const current = createProgressQueue({
      revision: room.revision ?? 0, controlVersion: room.controlVersion!,
      send: (pending, signal) => api(`/api/rooms/${room.code}/state`, { position: pending.position, controlVersion: pending.controlVersion, revision: pending.revision }, "PATCH", { signal, timeoutMs: 10000 }),
      read: signal => api<StateSnapshot>(`/api/rooms/${room.code}/state`, undefined, "GET", { signal, timeoutMs: 10000 }),
      online: () => navigator.onLine,
      local: pending => {
        if (!alive.current) return;
        if (pending) { cloudSaved.current = false; recordLocal(pending.position, pending); }
        else if (!clearPending(browserStorage(), key)) setStorageError("The saved pending marker could not be cleared on this device.");
      },
      status: state => { if (alive.current) { cloudSaved.current = state === "Synced"; setSyncState(state); } },
      lostControl: loseControl,
    });
    queue.current = current;
    if (restorable) current.restore(restorable);
    let wasOffline = !navigator.onLine;
    const offline = () => { wasOffline = true; if (current.hasPending()) setSyncState("Waiting for connection"); };
    const reconnect = () => { if (wasOffline && navigator.onLine) { wasOffline = false; current.retry(); } else current.kick(); };
    window.addEventListener("offline", offline); window.addEventListener("online", reconnect);
    return () => { alive.current = false; current.stop(); queue.current = null; window.removeEventListener("offline", offline); window.removeEventListener("online", reconnect); };
  }, [authenticated, key, loseControl, recordLocal, room.code, room.controlVersion, room.revision, restorable]);

  const update = useCallback((next: Position) => {
    if (!alive.current || takenOver) return;
    // EPUB's first relocation may repeat the restored position; do not replace
    // its expected revision or dirty marker until the queue reconciles it.
    if (samePosition(next, latest.current)) return;
    latest.current = next; setMe(next);
    if (authenticated) queue.current?.update(next); else recordLocal(next);
  }, [authenticated, recordLocal, takenOver]);
  const flushProgress = useCallback(async () => {
    if (!takenOver) {
      if (authenticated && queue.current?.hasPending()) {
        queue.current.persistLocal();
      } else recordLocal(latest.current);
    }
    const synced = authenticated ? await queue.current?.flush(2000) : false;
    return { safe: localSaved.current || !!synced || cloudSaved.current, pending: authenticated && !!queue.current?.hasPending() };
  }, [authenticated, key, recordLocal, takenOver]);
  const restoreLocal = useCallback(() => { if (stalePending && !takenOver) { const position = stalePending.position; setStalePending(null); update(position); return position; } return null; }, [stalePending, takenOver, update]);
  const useCloud = useCallback(() => { const position = queue.current?.useCloud(); if (position) { latest.current = position; setMe(position); recordLocal(position); return position; } return null; }, [recordLocal]);

  useEffect(() => {
    const client = supabase();
    const currentConnection = createPresenceConnection({
      createChannel: () => client.channel(`reading:${room.topic}`, { config: { presence: { key: String(room.seat) } } }),
      removeChannel: current => client.removeChannel(current), previousRemoval: removal.current,
      getPosition: () => latest.current, isOnline: () => navigator.onLine && alive.current && !takenOver,
      onStatus: status => { if (alive.current && !takenOver) setConnection(status); }, onUnavailable: () => { if (alive.current) { onlineRef.current = false; setOnline(false); } },
      onHighlightsChanged: () => highlightsChanged.current?.(),
      onSync: current => {
        if (!alive.current || takenOver) return;
        const entries = current.presenceState<Position>()[String(room.seat === 1 ? 2 : 1)] || [];
        const position = entries.find(isPosition); onlineRef.current = !!position; setOnline(!!position);
        if (position) { setPartner(position); try { localStorage.setItem(`${key}:partner`, JSON.stringify(position)); } catch { /* optional cache */ } }
      },
    });
    if (takenOver) { void currentConnection.stop(); return; }
    session.current = currentConnection;
    const reconnect = () => { if (document.visibilityState === "visible" && navigator.onLine && alive.current) currentConnection.reconnect(); };
    window.addEventListener("online", reconnect); window.addEventListener("offline", currentConnection.offline); document.addEventListener("visibilitychange", reconnect);
    return () => {
      window.removeEventListener("online", reconnect); window.removeEventListener("offline", currentConnection.offline); document.removeEventListener("visibilitychange", reconnect);
      session.current = null; removal.current = currentConnection.stop();
    };
  }, [room.topic, room.seat, key, takenOver]);
  useEffect(() => { if (!takenOver) session.current?.publish(); }, [me, takenOver]);

  useEffect(() => {
    let disposed = false; let running = false; const controller = new AbortController();
    const poll = async () => {
      if (disposed || running || document.visibilityState !== "visible" || !navigator.onLine || takenOver) return;
      running = true;
      try {
        const state = await api<StateSnapshot>(`/api/rooms/${room.code}/state`, undefined, "GET", { signal: controller.signal, timeoutMs: 10000 });
        if (disposed) return;
        if (!state.active || state.controlVersion !== (room.controlVersion ?? 0)) { loseControl(); return; }
        if (!onlineRef.current && isPosition(state.partner)) { setPartner(state.partner); try { localStorage.setItem(`${key}:partner`, JSON.stringify(state.partner)); } catch { /* optional cache */ } }
        queue.current?.kick();
      } catch { /* Poll failures do not reset the progress retry policy. */ }
      finally { running = false; }
    };
    void poll(); const timer = setInterval(() => void poll(), 5000);
    window.addEventListener("focus", poll); document.addEventListener("visibilitychange", poll);
    return () => { disposed = true; controller.abort(); clearInterval(timer); window.removeEventListener("focus", poll); document.removeEventListener("visibilitychange", poll); };
  }, [key, loseControl, room.code, room.controlVersion, takenOver]);

  return { me, partner, online, connection, storageError, syncState: authenticated ? syncState : "Saved on this device", update, notifyHighlights, takenOver, flushProgress,
    retrySync: () => queue.current?.retry(), keepLocal: () => queue.current?.keepLocal(), useCloud, stalePending: !!stalePending, restoreLocal };
}
