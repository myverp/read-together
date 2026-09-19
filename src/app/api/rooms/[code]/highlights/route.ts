import { randomInt } from "node:crypto";
import { NextResponse } from "next/server";
import { admin, controlFor, fail, HttpError, identity, seatFor } from "@/lib/server";
import { HIGHLIGHT_COLORS, isHighlightInput, type Highlight, type HighlightState } from "@/lib/highlights";

type Context = { params: Promise<{ code: string }> };

async function handle(request: Request, context: Context) {
  try {
    const who = await identity(request);
    const { code } = await context.params;
    if (!/^[A-F0-9]{12}$/.test(code)) throw new HttpError("Invalid room code.");
    const writing = request.method !== "GET";
    let input: unknown;
    if (writing) {
      const text = await request.text();
      if (text.length > 14000) throw new HttpError("This highlight is too long.", 413);
      try { input = JSON.parse(text); } catch { throw new HttpError("Invalid highlight."); }
      if (request.method === "POST" && !isHighlightInput(input)) throw new HttpError("Select up to 3,000 characters and keep comments under 1,000 characters.");
      if (request.method === "DELETE" && (!input || typeof input !== "object" || !("id" in input) || typeof input.id !== "string")) throw new HttpError("Invalid highlight.");
    }
    const db = admin();
    for (let attempt = 0; attempt < 8; attempt++) {
      const { data: room, error } = await db.from("reading_rooms")
        .select("*").eq("code", code).maybeSingle();
      if (error) throw error;
      const seat = room && seatFor(room, who);
      if (!room || !room.ready || !seat) throw new HttpError("Join this room before accessing highlights.", 403);
      const linked = !!(who.userId && (seat === 1 ? room.reader_one_user : room.reader_two_user) === who.userId);
      const control = controlFor(room, seat);
      if (writing && linked && control.hash !== who.controlHash) throw new HttpError("This room continued on another device.", 409, { takenOver: true });
      const state = room.highlight_state as HighlightState;
      const result = () => NextResponse.json({ revision: state.revision, items: state.items, colors: state.colors }, { headers: { "Cache-Control": "no-store" } });
      if (!writing) return result();
      const next: HighlightState = { ...state, revision: state.revision + 1 };
      if (request.method === "POST" && isHighlightInput(input)) {
        // A retried save keeps its original id and never creates a duplicate.
        if (state.items.some(h => h.id === input.id)) return result();
        if (state.items.length >= 500) throw new HttpError("This room has 500 highlights. Remove one before adding another.", 409);
        const colors = [...state.colors];
        const choices = HIGHLIGHT_COLORS.map((_, i) => i).filter(color => !colors.includes(color));
        const color = colors[seat - 1] >= 0 ? colors[seat - 1] : choices[randomInt(choices.length)];
        colors[seat - 1] = color;
        const mark: Highlight = { id: input.id, cfi: input.cfi, quote: input.quote.trim(), comment: input.comment.trim(), color, seat };
        next.items = [...state.items, mark];
        next.colors = colors;
      } else {
        const id = (input as { id: string }).id;
        const existing = state.items.find(h => h.id === id);
        if (!existing) return result();
        if (existing.seat !== seat) throw new HttpError("You can only remove your own highlights.", 403);
        next.items = state.items.filter(h => h.id !== id);
      }
      // Compare-and-swap also serializes color allocation for concurrent readers.
      let query = db.from("reading_rooms").update({ highlight_state: next })
        .eq("code", code).eq("highlight_state->>revision", String(state.revision));
      if (linked) query = query.eq(control.hashColumn, who.controlHash).eq(control.versionColumn, control.version);
      const { data: saved, error: updateError } = await query.select("code").maybeSingle();
      if (updateError) throw updateError;
      if (saved) return NextResponse.json({ revision: next.revision, items: next.items, colors: next.colors }, { headers: { "Cache-Control": "no-store" } });
    }
    throw new HttpError("Your partner is saving too. Please try again.", 409);
  } catch (error) { return fail(error); }
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
