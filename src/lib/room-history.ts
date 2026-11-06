export type SavedRoom = { code: string; seat: 1 | 2; title?: string; section?: string; archivedAt?: string | null; lastOpenedAt?: string };
type RoomStorage = Pick<Storage, "getItem" | "setItem">;
const CODE = /^[A-F0-9]{12}$/;
function timestamp(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function safeRoom(room: SavedRoom): SavedRoom {
  return { code: room.code, seat: room.seat,
    ...(typeof room.title === "string" && room.title.length <= 200 ? { title: room.title } : {}),
    ...(typeof room.section === "string" && room.section.length <= 300 ? { section: room.section } : {}),
    ...(room.archivedAt === null || timestamp(room.archivedAt) ? { archivedAt: room.archivedAt } : {}),
    ...(timestamp(room.lastOpenedAt) ? { lastOpenedAt: room.lastOpenedAt } : {}),
  };
}
export function savedRooms(storage: Pick<RoomStorage, "getItem">): SavedRoom[] {
  try {
    const value: unknown = JSON.parse(storage.getItem("read-together:rooms") || "[]");
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value.filter((room): room is SavedRoom => {
      if (!room || typeof room !== "object" || !CODE.test(room.code) || typeof room.code !== "string" ||
          (room.seat !== 1 && room.seat !== 2) || seen.has(room.code)) return false;
      seen.add(room.code); return true;
    }).map(safeRoom);
  } catch { return []; }
}
export function rememberRoom(storage: RoomStorage, room: SavedRoom) {
  const previous = savedRooms(storage);
  const entry = safeRoom({ ...previous.find(saved => saved.code === room.code), ...room, lastOpenedAt: new Date().toISOString() });
  const rooms = [entry, ...previous.filter(saved => saved.code !== room.code)];
  try { storage.setItem("read-together:room", room.code); } catch { /* The reader can still open. */ }
  try { storage.setItem("read-together:rooms", JSON.stringify(rooms)); } catch { /* The reader can still open. */ }
}
// Cache only confirmed metadata. Never touch saved/pending progress or discard history.
export function cacheRoomMetadata(storage: RoomStorage, entries: SavedRoom[]) {
  const metadata = new Map(entries.map(room => [room.code, safeRoom(room)]));
  const rooms = savedRooms(storage).map(room => metadata.has(room.code) ? safeRoom({ ...room, ...metadata.get(room.code) }) : room);
  try { storage.setItem("read-together:rooms", JSON.stringify(rooms)); } catch { /* Metadata remains usable in memory. */ }
}
export function lastRoom(storage: Pick<RoomStorage, "getItem">): { code: string; title?: string } | null {
  const rooms = savedRooms(storage).filter(room => !room.archivedAt);
  try {
    const code = storage.getItem("read-together:room");
    if (code && CODE.test(code) && !savedRooms(storage).some(room => room.code === code && room.archivedAt)) return rooms.find(room => room.code === code) ?? { code };
  } catch { /* Use the validated list, if available. */ }
  return rooms[0] ?? null;
}
