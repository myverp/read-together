"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, supabase } from "@/lib/client";
import { cacheRoomMetadata, savedRooms } from "@/lib/room-history";
import { readPosition } from "@/lib/local-progress";
import RoomActions from "./RoomActions";
import DeleteRoomDialog from "./DeleteRoomDialog";
import type { LibraryRoom } from "@/lib/types";

// Browser history cannot establish membership of the current profile.
type ListedRoom = Omit<LibraryRoom, "linked"> & { available: boolean; linked: boolean | null };
type LocalResult = { rooms: LibraryRoom[]; unavailable: string[] };
export default function RoomLibrary({ onOpenRoom, disabled = false }: { onOpenRoom: (code: string) => Promise<void>; disabled?: boolean }) {
  const [rooms, setRooms] = useState<ListedRoom[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [tab, setTab] = useState<"active" | "archive">("active");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string[]>([]);
  const [actionError, setActionError] = useState<{ code: string; archived: boolean; message: string } | null>(null);
  const [message, setMessage] = useState("");
  const [deletingRoom, setDeletingRoom] = useState<ListedRoom | null>(null);
  const request = useRef<AbortController | null>(null);
  const actions = useRef(new Set<string>());
  const activeTab = useRef<HTMLButtonElement>(null);
  const archiveTab = useRef<HTMLButtonElement>(null);
  const account = useRef<string | null | undefined>(undefined);

  const refresh = useCallback(async () => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setLoading(true); setError("");
    try {
      const { data } = await supabase().auth.getSession();
      if (controller.signal.aborted) return;
      const nextUserId = data.session?.user.id || null;
      const local = savedRooms(localStorage);
      const cached: ListedRoom[] = local.map(room => ({ ...room, title: room.title || "Saved room", section: room.section || "", createdAt: "",
        archivedAt: room.archivedAt || null, lastOpenedAt: room.lastOpenedAt || null, linked: null, available: true }));
      // Never retain another profile's list while its replacement is loading.
      if (account.current !== nextUserId) { account.current = nextUserId; setRooms(cached); setUserId(nextUserId); setActionError(null); setDeletingRoom(null); }
      const linked: LibraryRoom[] = [];
      if (nextUserId) {
        let cursor: string | null = null;
        do {
          const page: { rooms: LibraryRoom[]; nextCursor: string | null } = await api(`/api/rooms/library${cursor ? `?after=${cursor}` : ""}`, undefined, "GET", { signal: controller.signal });
          linked.push(...page.rooms); cursor = page.nextCursor;
        } while (cursor !== null);
      }
      const entries = new Map<string, ListedRoom>(cached.map(room => [room.code, room]));
      for (let start = 0; start < local.length; start += 100) {
        const page = await api<LocalResult>("/api/rooms/library", { codes: local.slice(start, start + 100).map(room => room.code) }, "POST", { signal: controller.signal });
        for (const code of page.unavailable) { const room = entries.get(code); if (room) entries.set(code, { ...room, available: false }); }
        for (const room of page.rooms) entries.set(room.code, { ...room, available: true });
      }
      for (const room of linked) entries.set(room.code, { ...room, available: true });
      if (controller.signal.aborted) return;
      const next = [...entries.values()].map(room => {
        const localSection = room.linked === false ? readPosition(localStorage, `read-together:${room.code}:${room.seat}`).section : "";
        return localSection && localSection !== "Opening book" ? { ...room, section: localSection } : room;
      });
      setRooms(next);
      cacheRoomMetadata(localStorage, next.filter(room => room.available).map(room => ({ ...room, lastOpenedAt: room.lastOpenedAt || undefined })));
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load your rooms.");
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }, []);
  useEffect(() => {
    void refresh();
    const { data } = supabase().auth.onAuthStateChange(() => { queueMicrotask(() => { void refresh(); }); });
    const reload = () => { void refresh(); };
    window.addEventListener("read-together:rooms-linked", reload);
    return () => { request.current?.abort(); data.subscription.unsubscribe(); window.removeEventListener("read-together:rooms-linked", reload); };
  }, [refresh]);

  async function archive(room: ListedRoom, archived: boolean) {
    if (actions.current.has(room.code)) return;
    const owner = account.current;
    actions.current.add(room.code); setBusy([...actions.current]); setActionError(null); setMessage("");
    try {
      const result = await api<{ code: string; archivedAt: string | null }>(`/api/rooms/${room.code}/archive`, { archived }, "PATCH");
      if (account.current !== owner) return;
      // A concurrent refresh must not replace a confirmed archive with an old response.
      request.current?.abort(); setLoading(false);
      setRooms(previous => previous.map(item => item.code === room.code ? { ...item, archivedAt: result.archivedAt } : item));
      cacheRoomMetadata(localStorage, [{ ...room, archivedAt: result.archivedAt, lastOpenedAt: room.lastOpenedAt || undefined }]);
      setMessage(archived ? "Room archived for you." : "Room restored to Active.");
      (tab === "active" ? activeTab : archiveTab).current?.focus();
    } catch (reason) { if (account.current === owner) setActionError({ code: room.code, archived, message: reason instanceof Error ? reason.message : "Could not update this room." }); }
    finally { actions.current.delete(room.code); setBusy([...actions.current]); }
  }

  const sorted = [...rooms].sort((a, b) => (Date.parse(b.lastOpenedAt || b.createdAt) || 0) - (Date.parse(a.lastOpenedAt || a.createdAt) || 0));
  const recent = sorted.find(room => room.available && !room.archivedAt && !room.deleting);
  const recentSection = recent?.section && recent.section !== "Opening book" ? recent.section : "";
  const visible = sorted.filter(room => tab === "archive" ? !!room.archivedAt : !room.archivedAt);
  const browserRooms = visible.filter(room => room.linked === false);
  function rows(group: ListedRoom[]) {
    return group.map(room => {
      const section = room.section && room.section !== "Opening book" ? room.section : "";
      return <li className="room-library-row" key={room.code}>
      <div className="room-library-info"><h3>{room.title}</h3><small>{room.code}</small>
        {room.deleting && <p role="status">Deletion started. Retry to finish cleanup.</p>}
        {room.available ? (section || room.linked === null) && <p className="muted" aria-hidden={!section || undefined}>{section || "\u00a0"}</p> : <p className="muted">Unavailable for this reader. Check the original browser or profile.</p>}
      </div>
      {room.available && <div className="room-library-actions">
        <button className="secondary" disabled={disabled || busy.includes(room.code) || room.deleting} aria-label={`${room.title} ${room.code} Continue`} onClick={() => void onOpenRoom(room.code)}>Continue</button>
        <RoomActions title={room.title} archived={!!room.archivedAt} disabled={disabled || busy.includes(room.code)} deleting={room.deleting}
          onArchive={() => void archive(room, !room.archivedAt)} onDelete={room.seat === 1 ? () => setDeletingRoom(room) : undefined} />
      </div>}
      {actionError?.code === room.code && <div className="room-library-error"><p className="error" role="alert">{actionError.message}</p><button className="secondary" disabled={busy.includes(room.code)} onClick={() => void archive(room, actionError.archived)}>Retry {actionError.archived ? "archive" : "restore"}</button></div>}
    </li>;
    });
  }
  return <>
    {deletingRoom && <DeleteRoomDialog code={deletingRoom.code} title={deletingRoom.title} onClose={() => { setDeletingRoom(null); void refresh(); }}
      onDeleted={cleaned => {
        request.current?.abort(); setLoading(false);
        setRooms(previous => previous.filter(room => room.code !== deletingRoom.code));
        setDeletingRoom(null); setActionError(null);
        setMessage(cleaned ? "Room permanently deleted." : "Room permanently deleted. Browser storage could not be fully cleared on this device.");
        window.dispatchEvent(new CustomEvent("read-together:room-deleted", { detail: deletingRoom.code }));
        requestAnimationFrame(() => (tab === "active" ? activeTab : archiveTab).current?.focus());
      }} />}
    {recent && <section className="panel continue-panel"><div><p className="continue-label">Continue reading</p><h2>{recent.title}</h2>{(recentSection || recent.linked === null) && <p className="muted" aria-hidden={!recentSection || undefined}>{recentSection || "\u00a0"}</p>}</div><button disabled={disabled} onClick={() => void onOpenRoom(recent.code)}>Continue reading</button></section>}
    <section className="panel room-library" aria-labelledby="room-library-title"><div className="room-library-heading"><h2 id="room-library-title">My rooms</h2>
      <div className="room-library-tabs" role="group" aria-label="Room list">
        <button ref={activeTab} className="secondary" aria-pressed={tab === "active"} onClick={() => { setTab("active"); setActionError(null); }}>Active</button>
        <button ref={archiveTab} className="secondary" aria-pressed={tab === "archive"} onClick={() => { setTab("archive"); setActionError(null); }}>Archive</button>
      </div>
      </div>
      {error && <div><p className="error" role="alert">{error}</p><button className="secondary" onClick={() => void refresh()}>Retry rooms</button></div>}
      {message && <p className="muted" role="status">{message}</p>}
      {!visible.length && !loading && <p className="muted">{tab === "archive" ? "No archived rooms." : "No active rooms yet. Open an EPUB or join an invitation."}</p>}
      {/* A confirmed membership must not replace a cached button mid-press. */}
      <ul className="room-library-list" key={userId || "guest"}>{userId ? [
        ...rows(visible.filter(room => room.linked === true)),
        ...rows(visible.filter(room => room.linked === null)),
        ...(browserRooms.length ? [<li key="browser-rooms-heading" role="presentation"><h3 className="room-library-group">On this device</h3><p className="muted">These guest rooms stay in this browser until you link them to your profile.</p></li>] : []),
        ...rows(browserRooms),
      ] : rows(visible)}</ul>
      {loading && <p className="muted" role="status">Loading rooms...</p>}
      {!!rooms.length && <p className="muted room-library-note">Archive hides a room only for you. Done here saves your place and keeps the room active. You can open an archived room without restoring it.</p>}
    </section>
  </>;
}
