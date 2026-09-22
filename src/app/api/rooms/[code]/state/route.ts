import { admin, controlFor, fail, HttpError, identity, seatFor } from "@/lib/server";
import { isPosition } from "@/lib/types";

type Context = { params: Promise<{ code: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const who = await identity(request); const { code } = await context.params;
    const { data: room, error } = await admin().from("reading_rooms").select("reader_one,reader_two,reader_one_user,reader_two_user,control_hash_one,control_hash_two,control_version_one,control_version_two,position_one,position_two").eq("code", code).maybeSingle();
    if (error) throw error;
    const seat = room && seatFor(room, who);
    if (!room || !seat) throw new HttpError("Join this room before reading its progress.", 403);
    const linked = !!(who.userId && (seat === 1 ? room.reader_one_user : room.reader_two_user) === who.userId);
    const control = controlFor(room, seat);
    return Response.json({ active: !linked || control.hash === who.controlHash, controlVersion: control.version,
      me: seat === 1 ? room.position_one : room.position_two, partner: seat === 1 ? room.position_two : room.position_one }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error); }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const who = await identity(request); const { code } = await context.params; const body = await request.json();
    if (!isPosition(body.position)) throw new HttpError("Invalid reading position.");
    const db = admin(); const { data: room, error } = await db.from("reading_rooms").select("reader_one,reader_two,reader_one_user,reader_two_user,control_hash_one,control_hash_two,control_version_one,control_version_two").eq("code", code).maybeSingle();
    if (error) throw error;
    const seat = room && seatFor(room, who); if (!room || !seat) throw new HttpError("Join this room before saving progress.", 403);
    const linked = !!(who.userId && (seat === 1 ? room.reader_one_user : room.reader_two_user) === who.userId);
    const control = controlFor(room, seat);
    let query = db.from("reading_rooms").update({ [control.positionColumn]: body.position }).eq("code", code);
    if (linked) {
      if (!Number.isInteger(body.controlVersion)) throw new HttpError("Reader control is stale.", 409, { takenOver: true });
      query = query.eq(control.hashColumn, who.controlHash).eq(control.versionColumn, body.controlVersion);
    } else {
      query = query.eq(seat === 1 ? "reader_one" : "reader_two", who.guestHash).is(seat === 1 ? "reader_one_user" : "reader_two_user", null);
    }
    const { data: saved, error: saveError } = await query.select(control.versionColumn).maybeSingle();
    if (saveError) throw saveError;
    if (!saved) throw new HttpError("This room continued on another device.", 409, { takenOver: true });
    return Response.json({ position: body.position, controlVersion: control.version });
  } catch (error) { return fail(error); }
}
