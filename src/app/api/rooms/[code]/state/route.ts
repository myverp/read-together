import { admin, controlFor, fail, HttpError, identity, seatFor } from "@/lib/server";
import { isPosition } from "@/lib/types";

type Context = { params: Promise<{ code: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const who = await identity(request); const { code } = await context.params;
    const { data: room, error } = await admin().from("reading_rooms").select("reader_one,reader_two,reader_one_user,reader_two_user,control_hash_one,control_hash_two,control_version_one,control_version_two,position_one,position_two,position_revision_one,position_revision_two").eq("code", code).maybeSingle();
    if (error) throw error;
    const seat = room && seatFor(room, who);
    if (!room || !seat) throw new HttpError("Join this room before reading its progress.", 403);
    const linked = !!(who.userId && (seat === 1 ? room.reader_one_user : room.reader_two_user) === who.userId);
    const control = controlFor(room, seat);
    return Response.json({ active: !linked || control.hash === who.controlHash, controlVersion: control.version,
      revision: Number(seat === 1 ? room.position_revision_one : room.position_revision_two),
      me: seat === 1 ? room.position_one : room.position_two, partner: seat === 1 ? room.position_two : room.position_one }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error, { operation: "read-progress", route: "/api/rooms/[code]/state" }); }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const who = await identity(request); const { code } = await context.params; const body = await request.json();
    if (!isPosition(body.position)) throw new HttpError("Invalid reading position.");
    if (body.revision !== undefined && (!Number.isSafeInteger(body.revision) || body.revision < 0)) throw new HttpError("Invalid progress revision.");
    const db = admin(); const { data: room, error } = await db.from("reading_rooms").select("reader_one,reader_two,reader_one_user,reader_two_user,control_hash_one,control_hash_two,control_version_one,control_version_two").eq("code", code).maybeSingle();
    if (error) throw error;
    const seat = room && seatFor(room, who); if (!room || !seat) throw new HttpError("Join this room before saving progress.", 403);
    const linked = !!(who.userId && (seat === 1 ? room.reader_one_user : room.reader_two_user) === who.userId);
    if (linked && !Number.isSafeInteger(body.controlVersion)) throw new HttpError("Reader control is stale.", 409, { takenOver: true, code: "control_changed" });
    const { data: saved, error: saveError } = await db.rpc("save_reading_progress", {
      p_code: code, p_seat: seat, p_user: who.userId, p_guest_hash: who.guestHash,
      p_control_hash: who.controlHash, p_control_version: body.controlVersion ?? null,
      p_revision: body.revision ?? null, p_position: body.position,
    });
    if (saveError) throw saveError;
    if (saved?.code === "control_changed") throw new HttpError("This room continued on another device.", 409, { takenOver: true, code: "control_changed" });
    if (saved?.code === "access_denied") throw new HttpError("Join this room before saving progress.", 403);
    if (saved?.code === "revision_conflict") throw new HttpError("Another position was saved. Choose which position to keep.", 409, { code: "revision_conflict" });
    return Response.json({ ...saved, controlVersion: controlFor(room, seat).version, legacyClient: body.revision === undefined });
  } catch (error) { return fail(error, { operation: "save-progress", route: "/api/rooms/[code]/state" }); }
}
