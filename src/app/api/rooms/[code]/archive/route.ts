import { admin, fail, HttpError, identity, requireAvailableRoom, seatFor } from "@/lib/server";
export async function PATCH(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    const who = await identity(request); const { code } = await context.params;
    if (!/^[A-F0-9]{12}$/.test(code)) throw new HttpError("Invalid room code.");
    const body = await request.json();
    if (typeof body.archived !== "boolean") throw new HttpError("Choose archive or restore.");
    const db = admin();
    const { data: room, error } = await db.from("reading_rooms").select("reader_one,reader_two,reader_one_user,reader_two_user,ready,cleanup_started_at,deletion_requested_at").eq("code", code).maybeSingle();
    if (error) throw error;
    if (room?.deletion_requested_at) requireAvailableRoom(room);
    const seat = room && seatFor(room, who);
    if (!room || !seat || !room.ready || room.cleanup_started_at) throw new HttpError("This room is unavailable for this reader.", 404);
    const column = seat === 1 ? "archived_at_one" : "archived_at_two";
    const userColumn = seat === 1 ? "reader_one_user" : "reader_two_user";
    const readerColumn = seat === 1 ? "reader_one" : "reader_two";
    const archivedAt = body.archived ? new Date().toISOString() : null;
    let query = db.from("reading_rooms").update({ [column]: archivedAt }).eq("code", code).is("cleanup_started_at", null);
    query = room[userColumn] ? query.eq(userColumn, who.userId!) : query.is(userColumn, null).eq(readerColumn, who.guestHash);
    const { data: saved, error: saveError } = await query.select("code").maybeSingle();
    if (saveError) throw saveError;
    if (!saved) throw new HttpError("The room changed. Refresh your rooms and retry.", 409);
    return Response.json({ code, archivedAt }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error, { operation: "archive-room", route: "/api/rooms/[code]/archive" }); }
}
