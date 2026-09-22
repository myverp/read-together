import { admin, controlFor, fail, HttpError, identity, seatFor } from "@/lib/server";
import type { HighlightState } from "@/lib/highlights";

export async function PATCH(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    const who = await identity(request); const { code } = await context.params; const { color } = await request.json();
    if (!Number.isInteger(color) || color < 0 || color > 9) throw new HttpError("Choose an available highlight color.");
    const db = admin();
    for (let attempt = 0; attempt < 8; attempt++) {
      const { data: room, error } = await db.from("reading_rooms").select("reader_one,reader_two,reader_one_user,reader_two_user,control_hash_one,control_hash_two,control_version_one,control_version_two,highlight_state").eq("code", code).maybeSingle();
      if (error) throw error;
      const seat = room && seatFor(room, who); if (!room || !seat) throw new HttpError("Join this room before changing its color.", 403);
      const linked = !!(who.userId && (seat === 1 ? room.reader_one_user : room.reader_two_user) === who.userId);
      const control = controlFor(room, seat);
      if (linked && control.hash !== who.controlHash) throw new HttpError("This room continued on another device.", 409, { takenOver: true });
      const state = room.highlight_state as HighlightState;
      if (state.colors[seat === 1 ? 1 : 0] === color) throw new HttpError("Your partner already uses that color.", 409);
      const next = { revision: state.revision + 1, colors: state.colors.map((value, index) => index === seat - 1 ? color : value), items: state.items.map(mark => mark.seat === seat ? { ...mark, color } : mark) };
      let query = db.from("reading_rooms").update({ highlight_state: next }).eq("code", code)
        .eq("highlight_state->>revision", String(state.revision));
      if (linked) query = query.eq(control.hashColumn, who.controlHash).eq(control.versionColumn, control.version);
      const { data: saved, error: saveError } = await query.select("code").maybeSingle();
      if (saveError) throw saveError;
      if (saved) return Response.json({ color, revision: next.revision, items: next.items, colors: next.colors });
    }
    throw new HttpError("Your partner is saving too. Try again.", 409);
  } catch (error) { return fail(error); }
}
