import { admin, HttpError, tokenHash } from "@/lib/server";
import { elevenlabs, SpeechError } from "@/lib/elevenlabs";

export const maxDuration = 60;

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    const hash = tokenHash(request);
    const { code } = await context.params;
    if (!/^[A-F0-9]{12}$/.test(code)) throw new HttpError("Invalid room code.");
    // Bound the body while reading, including requests without Content-Length.
    const reader = request.body?.getReader();
    if (!reader) throw new HttpError("Missing audio request.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 64000) { await reader.cancel(); throw new HttpError("This page is too long.", 413); }
      chunks.push(value);
    }
    let input;
    try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new HttpError("Invalid audio request."); }
    if (!input || typeof input !== "object" || !["voices", "speech"].includes(input.action)) throw new HttpError("Invalid audio request.");
    const { data: room, error } = await admin().from("reading_rooms").select("reader_one,reader_two,ready").eq("code", code).maybeSingle();
    if (error) throw new HttpError("Room service unavailable. Try again.", 503);
    if (!room?.ready || (hash !== room.reader_one && hash !== room.reader_two)) throw new HttpError("Join this room before using audio.", 403);
    return await elevenlabs(request.headers.get("x-elevenlabs-key") || "", input.action === "speech" ? { text: input.text ?? "", voice: input.voice } : { search: typeof input.search === "string" ? input.search : "" }, AbortSignal.any([request.signal, AbortSignal.timeout(55000)]));
  } catch (error) {
    // No logging: request data contains a personal API key and private book text.
    const known = error instanceof HttpError || error instanceof SpeechError;
    return Response.json({ error: known ? error.message : "Audio request failed. Please try again." }, { status: known ? error.status : 503, headers: { "Cache-Control": "no-store" } });
  }
}
