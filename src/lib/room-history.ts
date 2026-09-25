type SavedRoom = { code: string; seat: 1 | 2 };
type RoomStorage = Pick<Storage, "getItem" | "setItem">;

const CODE = /^[A-F0-9]{12}$/;

export function savedRooms(storage: Pick<RoomStorage, "getItem">): SavedRoom[] {
  try {
    const value: unknown = JSON.parse(storage.getItem("read-together:rooms") || "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((room): room is SavedRoom =>
      !!room && typeof room === "object" &&
      CODE.test((room as SavedRoom).code) &&
      ((room as SavedRoom).seat === 1 || (room as SavedRoom).seat === 2)
    ).slice(0, 50);
  } catch { return []; }
}

export function rememberRoom(storage: RoomStorage, room: SavedRoom) {
  const rooms = [room, ...savedRooms(storage).filter(saved => saved.code !== room.code)].slice(0, 50);
  try { storage.setItem("read-together:room", room.code); } catch { /* The reader can still open. */ }
  try { storage.setItem("read-together:rooms", JSON.stringify(rooms)); } catch { /* The reader can still open. */ }
}
