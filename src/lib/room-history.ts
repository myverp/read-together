export type SavedRoom = { code: string; seat: 1 | 2; title?: string };
type RoomStorage = Pick<Storage, "getItem" | "setItem">;

const CODE = /^[A-F0-9]{12}$/;

export function savedRooms(storage: Pick<RoomStorage, "getItem">): SavedRoom[] {
  try {
    const value: unknown = JSON.parse(storage.getItem("read-together:rooms") || "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((room): room is SavedRoom =>
      !!room && typeof room === "object" &&
      typeof (room as SavedRoom).code === "string" &&
      CODE.test((room as SavedRoom).code) &&
      ((room as SavedRoom).seat === 1 || (room as SavedRoom).seat === 2)
    ).slice(0, 50).map(room => ({ code: room.code, seat: room.seat,
      ...(typeof room.title === "string" && room.title.length <= 200 ? { title: room.title } : {}),
    }));
  } catch { return []; }
}

export function rememberRoom(storage: RoomStorage, room: SavedRoom) {
  // Structural TypeScript types do not strip extra fields from a Room object.
  // Persist a small allowlist, never its signed URL or Realtime capability.
  const entry: SavedRoom = { code: room.code, seat: room.seat, ...(room.title ? { title: room.title.slice(0, 200) } : {}) };
  const rooms = [entry, ...savedRooms(storage).filter(saved => saved.code !== room.code)].slice(0, 50);
  try { storage.setItem("read-together:room", room.code); } catch { /* The reader can still open. */ }
  try { storage.setItem("read-together:rooms", JSON.stringify(rooms)); } catch { /* The reader can still open. */ }
}

export function lastRoom(storage: Pick<RoomStorage, "getItem">): { code: string; title?: string } | null {
  const rooms = savedRooms(storage);
  try {
    const code = storage.getItem("read-together:room");
    if (code && CODE.test(code)) return rooms.find(room => room.code === code) ?? { code };
  } catch { /* Use the validated list, if available. */ }
  return rooms[0] ?? null;
}
