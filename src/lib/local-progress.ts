import { EMPTY_POSITION, isPosition, type Position } from "./types.ts";

export type PendingProgress = { format: 1; position: Position; controlVersion: number; revision: number };
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem"> | null;
export function browserStorage(): Storage { try { return window.localStorage; } catch { return null; } }
export const samePosition = (a: Position, b: Position) => a.cfi === b.cfi && a.section === b.section && a.done === b.done;
export function readPosition(storage: Storage, key: string): Position {
  try { const value = JSON.parse(storage?.getItem(key) || "null"); return isPosition(value) ? value : EMPTY_POSITION; } catch { return EMPTY_POSITION; }
}
export function readPending(storage: Storage, key: string): PendingProgress | null {
  try {
    const value = JSON.parse(storage?.getItem(`${key}:pending`) || "null");
    return value?.format === 1 && isPosition(value.position) && Number.isSafeInteger(value.controlVersion) && value.controlVersion > 0 && Number.isSafeInteger(value.revision) && value.revision >= 0 ? value : null;
  } catch { return null; }
}
export function saveProgress(storage: Storage, key: string, position: Position, pending?: PendingProgress): boolean {
  try {
    if (!storage) return false;
    storage.setItem(key, JSON.stringify(position));
    if (pending) storage.setItem(`${key}:pending`, JSON.stringify(pending));
    return true;
  } catch { return false; }
}
export function clearPending(storage: Storage, key: string): boolean {
  try { if (!storage) return false; storage.removeItem(`${key}:pending`); return true; } catch { return false; }
}
