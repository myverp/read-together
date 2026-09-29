export const ROOM_CODE = /^[A-F0-9]{12}$/;

export function invitationCode(input: string, origin: string): string | null {
  const value = input.trim();
  const code = value.replace(/\s/g, "").toUpperCase();
  if (ROOM_CODE.test(code)) return code;
  try {
    if (!/^https?:\/\/[^/?#]+\/room\/[a-f0-9]{12}$/i.test(value)) return null;
    const url = new URL(value);
    if (url.origin !== origin || url.username || url.password || url.search || url.hash) return null;
    const match = /^\/room\/([a-f0-9]{12})$/i.exec(url.pathname);
    return match ? match[1].toUpperCase() : null;
  } catch { return null; }
}

export const roomPath = (code: string) => `/room/${code}`;

// A click on the home form is already explicit consent to enter. This contains
// no credentials and is never set by GET, prefetch or a shared URL.
const requested = new Set<string>();
export function requestRoomEntry(code: string) { requested.add(code); }
export function consumeRoomEntry(code: string) { const found = requested.has(code); requested.delete(code); return found; }

let exitWarning = "";
export function rememberExitWarning(message = "") { exitWarning = message; }
export function takeExitWarning() { const message = exitWarning; exitWarning = ""; return message; }
