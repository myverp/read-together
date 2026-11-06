import { savedRooms } from "./room-history.ts";

// Called only after confirmed permanent deletion, never after a list/read error.
export function forgetDeletedRoom(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">, code: string): boolean {
  try {
    storage.setItem("read-together:rooms", JSON.stringify(savedRooms(storage).filter(room => room.code !== code)));
    for (const key of ["read-together:room", "read-together:demo"])
      if (storage.getItem(key) === code) storage.removeItem(key);
    for (const seat of [1, 2]) for (const suffix of ["", ":pending", ":partner"])
      storage.removeItem(`read-together:${code}:${seat}${suffix}`);
    return true;
  } catch { return false; }
}
