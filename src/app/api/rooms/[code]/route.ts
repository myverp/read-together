import { admin, controlFor, ensureProfile, fail, HttpError, identity, occupantHash, roomResponse, seatFor } from "@/lib/server";
import type { HighlightState } from "@/lib/highlights";

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
    let room = initial;
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
      const { data: ready, error: updateError } = await db.from("reading_rooms").update({ ready: true }).eq("code", code).select("*").single();
      if (updateError) throw updateError; room = ready;
    }
    return await roomResponse(room, seat);
  } catch (error) { return fail(error); }
}
