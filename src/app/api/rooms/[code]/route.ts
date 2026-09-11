import { admin, fail, HttpError, roomResponse, tokenHash } from "@/lib/server";

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    const hash = tokenHash(request);
    const { code } = await context.params;
    if (!/^[A-F0-9]{12}$/.test(code)) throw new HttpError("Enter the 12-character room code.");
    const db = admin();
    const { data: room, error } = await db.from("reading_rooms").select("*").eq("code", code).maybeSingle();
    if (error) throw error;
    if (!room) throw new HttpError("Room not found. Check the code.", 404);
    if (room.reader_one === hash) {
      if (!room.ready) {
        const { data: files, error: fileError } = await db.storage.from("epubs").list(room.book_path.split("/")[0]);
        if (fileError) throw fileError;
        if (!files?.some(f => f.name === "book.epub")) throw new HttpError("The EPUB upload has not finished. Upload it again.", 409);
        const { error: updateError } = await db.from("reading_rooms").update({ ready: true }).eq("code", code);
        if (updateError) throw updateError;
      }
      return await roomResponse(room, 1);
    }
    if (!room.ready) throw new HttpError("The EPUB is still uploading. Try again shortly.", 409);
    if (room.reader_two === hash) return await roomResponse(room, 2);
    // Atomic conditional UPDATE: two concurrent joiners cannot claim the same seat.
    const { data: claimed, error: claimError } = await db.from("reading_rooms")
      .update({ reader_two: hash }).eq("code", code).is("reader_two", null).select("*").maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) throw new HttpError("This room already has two readers. Reopen it in the browser you originally used.", 409);
    return await roomResponse(claimed, 2);
  } catch (error) { return fail(error); }
}
