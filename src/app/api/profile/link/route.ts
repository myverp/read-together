import { admin, controlFor, ensureProfile, fail, HttpError, identity, occupantHash } from "@/lib/server";
import type { HighlightState } from "@/lib/highlights";
import { isPosition, type Position } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const who = await identity(request); const profile = await ensureProfile(who);
    const body = await request.json();
    const entries = Array.isArray(body.rooms) ? body.rooms.filter((entry: unknown): entry is { code: string; position: Position } => {
      if (!entry || typeof entry !== "object") return false;
      const value = entry as { code?: unknown; position?: unknown };
      return typeof value.code === "string" && /^[A-F0-9]{12}$/.test(value.code) && isPosition(value.position);
    }).slice(0, 50) : [];
    if (!entries.length) throw new HttpError("There are no browser rooms to link.");
    const db = admin(); const linked: string[] = []; const skipped: { code: string; reason: string }[] = [];
    for (const { code, position } of entries) {
      const { data: room, error } = await db.from("reading_rooms").select("*").eq("code", code).maybeSingle();
      if (error) throw error;
      if (!room) { skipped.push({ code, reason: "Room not found" }); continue; }
      const seat = !room.reader_one_user && room.reader_one === who.guestHash ? 1
        : !room.reader_two_user && room.reader_two === who.guestHash ? 2 : null;
      if (!seat) { skipped.push({ code, reason: "This browser does not own an unlinked seat" }); continue; }
      if ((seat === 1 ? room.reader_two_user : room.reader_one_user) === who.userId) { skipped.push({ code, reason: "Your profile already has the other seat" }); continue; }
      const userColumn = seat === 1 ? "reader_one_user" : "reader_two_user";
      const control = controlFor(room, seat);
      const state = room.highlight_state as HighlightState;
      const occupied = state.colors[seat === 1 ? 1 : 0];
      const preferred = profile.preferred_color as number;
      const color = preferred !== occupied ? preferred : Array.from({ length: 10 }, (_, index) => index).find(index => index !== occupied) ?? 0;
      const nextState = { ...state, revision: state.revision + 1, colors: state.colors.map((value, index) => index === seat - 1 ? color : value), items: state.items.map(mark => mark.seat === seat ? { ...mark, color } : mark) };
      const { data: saved, error: saveError } = await db.from("reading_rooms").update({
        [userColumn]: who.userId, [seat === 1 ? "reader_one" : "reader_two"]: occupantHash(who), [control.hashColumn]: who.controlHash,
        [control.versionColumn]: control.version + 1, highlight_state: nextState,
        [control.positionColumn]: position,
      }).eq("code", code).is(userColumn, null).eq(seat === 1 ? "reader_one" : "reader_two", who.guestHash)
        .eq("highlight_state->>revision", String(state.revision)).select("code").maybeSingle();
      if (saveError) throw saveError;
      if (saved) linked.push(code); else skipped.push({ code, reason: "The seat changed while linking" });
    }
    return Response.json({ linked, skipped });
  } catch (error) { return fail(error); }
}
