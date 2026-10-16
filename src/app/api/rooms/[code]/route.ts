import { admin, controlFor, ensureProfile, fail, HttpError, identity, occupantHash, requireAvailableRoom, roomResponse, seatFor } from "@/lib/server";
import { deleteMarkedRoom } from "@/lib/room-deletion-server";
import type { HighlightState } from "@/lib/highlights";

export async function DELETE(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    const who = await identity(request);
    const { code } = await context.params;
    if (!/^[A-F0-9]{12}$/.test(code)) throw new HttpError("Invalid room code.");
    const body = await request.json();
    if (body?.confirmation !== "ВИДАЛИТИ") throw new HttpError("Type ВИДАЛИТИ to confirm permanent deletion.");
    const db = admin();
    const { data, error } = await db.rpc("request_room_deletion", {
      p_code: code, p_user: who.userId, p_guest_hash: who.guestHash, p_control_hash: who.controlHash,
    });
    if (error) throw error;
    if (data?.code === "access_denied") throw new HttpError("Only the room creator can delete this room.", 403);
    if (data?.code === "control_changed") throw new HttpError("Open this room and choose Continue here before deleting it from this device.", 409, { code: "control_changed" });
    if (data?.code === "deletion_in_progress") throw new HttpError("Deletion already started on another device. Cleanup will finish automatically, or you can retry from that device.", 409);
    if (data?.code === "not_ready") throw new HttpError("Finish opening this room before deleting it.", 409);
    if (data?.code === "deleting") await deleteMarkedRoom(db, code, data.book_path);
    else if (data?.code !== "absent") throw new Error("Unexpected deletion result");
    return Response.json({ deleted: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error, { operation: "delete-room", route: "/api/rooms/[code]" }); }
}

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    const who = await identity(request);
    const { code } = await context.params;
    if (!/^[A-F0-9]{12}$/.test(code)) throw new HttpError("Enter the 12-character room code.");
    let body: { takeover?: boolean } = {};
    try { body = await request.json(); } catch { /* Older clients send no body. */ }
    const db = admin();
    const { data: initial, error } = await db.from("reading_rooms").select("*").eq("code", code).maybeSingle();
    if (error) throw error;
    if (!initial) throw new HttpError("Room not found. Check the code.", 404);
    requireAvailableRoom(initial);
    let room = initial;
    if (room.cleanup_started_at) throw new HttpError("This unfinished room has expired. Create a new room.", 410);
    let seat = seatFor(room, who);
    const linked = !!(seat && who.userId && (seat === 1 ? room.reader_one_user : room.reader_two_user) === who.userId);

    if (linked && seat) {
      const control = controlFor(room, seat);
      if (control.hash !== who.controlHash) {
        if (!body.takeover && control.hash) throw new HttpError("This profile is already reading this room on another device.", 409, { takeoverRequired: true });
        const nextVersion = control.version + 1;
        let query = db.from("reading_rooms").update({ [control.hashColumn]: who.controlHash, [control.versionColumn]: nextVersion })
          .eq("code", code).eq(control.versionColumn, control.version);
        query = control.hash ? query.eq(control.hashColumn, control.hash) : query.is(control.hashColumn, null);
        const { data: claimed, error: claimError } = await query.select("*").maybeSingle();
        if (claimError) throw claimError;
        if (!claimed) throw new HttpError("Reader control changed. Try Continue here again.", 409, { takeoverRequired: true });
        room = claimed;
      }
    } else if (!seat) {
      if (!room.ready) throw new HttpError("The EPUB is still uploading. Try again shortly.", 409);
      if (who.userId && (room.reader_one_user === who.userId || room.reader_two_user === who.userId)) throw new HttpError("A profile cannot occupy both seats.", 409);
      if (room.reader_two !== null) throw new HttpError("This room already has two readers. Reopen it with the original browser or profile.", 409);
      const profile = who.userId ? await ensureProfile(who) : null;
      const state = room.highlight_state as HighlightState;
      const preferred = profile?.preferred_color ?? -1;
      const color = preferred >= 0 && preferred !== state.colors[0]
        ? preferred : Array.from({ length: 10 }, (_, index) => index).find(index => index !== state.colors[0]) ?? 0;
      const nextState = { ...state, revision: state.revision + 1, colors: [state.colors[0], color] };
      const { data: claimed, error: claimError } = await db.from("reading_rooms").update({
        reader_two: occupantHash(who), reader_two_user: who.userId,
        control_hash_two: who.userId ? who.controlHash : null,
        control_version_two: who.userId ? 1 : 0,
        highlight_state: nextState,
      }).eq("code", code).is("reader_two", null).eq("highlight_state->>revision", String(state.revision)).select("*").maybeSingle();
      if (claimError) throw claimError;
      if (!claimed) throw new HttpError("Another reader joined first. Try reopening the room.", 409);
      room = claimed; seat = 2;
    }

    if (!seat) throw new HttpError("You do not have a seat in this room.", 403);
    if (seat === 1 && !room.ready) {
      const { data: files, error: fileError } = await db.storage.from("epubs").list(room.book_path.split("/")[0]);
      if (fileError) throw fileError;
      if (!files?.some((file: { name: string }) => file.name === "book.epub")) throw new HttpError("The EPUB upload has not finished. Upload it again.", 409);
      const { data: ready, error: updateError } = await db.from("reading_rooms").update({ ready: true }).eq("code", code).is("cleanup_started_at", null).select("*").maybeSingle();
      if (updateError) throw updateError;
      if (!ready) throw new HttpError("This unfinished room has expired. Create a new room.", 410);
      room = ready;
    }
    const response = await roomResponse(room, seat);
    const { error: openedError } = await db.from("reading_rooms").update({ [seat === 1 ? "last_opened_at_one" : "last_opened_at_two"]: new Date().toISOString() }).eq("code", code)
      .eq(seat === 1 ? "reader_one" : "reader_two", seat === 1 ? room.reader_one : room.reader_two);
    if (openedError) throw openedError;
    return response;
  } catch (error) { return fail(error, { operation: "enter-room", route: "/api/rooms/[code]" }); }
}
