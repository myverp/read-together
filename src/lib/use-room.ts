"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./client";
import { EMPTY_POSITION, isPosition, type Position, type Room } from "./types";
import { createPresenceConnection } from "./presence-connection";

function restore(key: string): Position {
  try { const saved = JSON.parse(localStorage.getItem(key) || "null"); return isPosition(saved) ? saved : EMPTY_POSITION; }
  catch { return EMPTY_POSITION; }
}

export function useRoom(room: Room, onHighlightsChanged?: () => void) {
  const key = `read-together:${room.code}:${room.seat}`;
  const [me, setMe] = useState<Position>(() => restore(key));
  const [partner, setPartner] = useState<Position>(() => restore(`${key}:partner`));
  const [online, setOnline] = useState(false);
  const [connection, setConnection] = useState("Connecting…");
  const [storageError, setStorageError] = useState("");
  const latest = useRef(me);
  const session = useRef<ReturnType<typeof createPresenceConnection> | null>(null);
  const removal = useRef<Promise<void>>(Promise.resolve());
  const highlightsChanged = useRef(onHighlightsChanged);
  highlightsChanged.current = onHighlightsChanged;

  const notifyHighlights = useCallback(() => {
    session.current?.notifyHighlights();
  }, []);

  const update = useCallback((next: Position) => {
    latest.current = next;
    setMe(next);
    try { localStorage.setItem(key, JSON.stringify(next)); }
    catch { setStorageError("Browser storage is full or unavailable. Your position cannot be saved on this device."); }
  }, [key]);

  useEffect(() => {
    const client = supabase();
    const connection = createPresenceConnection({
      createChannel: () => client.channel(`reading:${room.topic}`, { config: { presence: { key: String(room.seat) } } }),
      removeChannel: current => client.removeChannel(current),
      previousRemoval: removal.current,
      getPosition: () => latest.current,
      isOnline: () => navigator.onLine,
      onStatus: setConnection,
      onUnavailable: () => setOnline(false),
      onHighlightsChanged: () => highlightsChanged.current?.(),
      onSync: current => {
        const entries = current.presenceState<Position>()[String(room.seat === 1 ? 2 : 1)] || [];
        const p = entries.find(isPosition);
        setOnline(!!p);
        if (p) {
          const position = { cfi: p.cfi, section: p.section, done: p.done };
          setPartner(position);
          try { localStorage.setItem(`${key}:partner`, JSON.stringify(position)); } catch { /* Partner cache is optional. */ }
        }
      },
    });
    session.current = connection;
    const reconnect = () => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        connection.reconnect();
      }
    };
    window.addEventListener("online", reconnect);
    window.addEventListener("offline", connection.offline);
    document.addEventListener("visibilitychange", reconnect);
    return () => {
      window.removeEventListener("online", reconnect);
      window.removeEventListener("offline", connection.offline);
      document.removeEventListener("visibilitychange", reconnect);
      session.current = null;
      removal.current = connection.stop();
    };
  }, [room.topic, room.seat, key]);

  useEffect(() => { session.current?.publish(); }, [me]);

  return { me, partner, online, connection, storageError, update, notifyHighlights };
}
