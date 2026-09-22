import { NextResponse } from 'next/server';
import { admin, controlFor, fail, HttpError, identity, seatFor } from '@/lib/server';
import { isDrawingInput, type Drawing, type DrawingState } from '@/lib/drawings';
import { HIGHLIGHT_COLORS } from '@/lib/highlights';
type Context = { params: Promise<{ code: string }> };
async function handle(request: Request, context: Context) {
  try {
    const who = await identity(request);
    const { code } = await context.params;
    if (!/^[A-F0-9]{12}$/.test(code)) throw new HttpError('Invalid room code.');
    const writing = request.method !== 'GET';
    let input: unknown;
    if (writing) {
      const body = await request.text();
      if (body.length > 180000) throw new HttpError('This drawing is too large.', 413);
      try { input = JSON.parse(body); } catch { throw new HttpError('Invalid drawing.'); }
      if (request.method === 'POST' && !isDrawingInput(input)) throw new HttpError('This drawing has invalid or too much content.');
      if (request.method === 'DELETE' && (!input || typeof input !== 'object' || !('id' in input) || typeof input.id !== 'string')) throw new HttpError('Invalid drawing.');
    }
    const db = admin();
    for (let attempt = 0; attempt < 8; attempt++) {
      const { data: room, error } = await db.from('reading_rooms').select('ready,reader_one,reader_two,reader_one_user,reader_two_user,control_hash_one,control_hash_two,control_version_one,control_version_two,highlight_state,drawing_state').eq('code', code).maybeSingle();
      if (error) throw error;
      const seat = room && seatFor(room, who);
      if (!room || !room.ready || !seat) throw new HttpError('Join this room before accessing drawings.', 403);
      const linked = !!(who.userId && (seat === 1 ? room.reader_one_user : room.reader_two_user) === who.userId);
      const control = controlFor(room, seat);
      if (writing && linked && control.hash !== who.controlHash) throw new HttpError('This room continued on another device.', 409, { takenOver: true });
      const state = room.drawing_state as DrawingState;
      const result = () => NextResponse.json(state, { headers: { 'Cache-Control': 'no-store' } });
      if (!writing) return result();
      const next: DrawingState = { revision: state.revision + 1, items: state.items };
      if (request.method === 'POST' && isDrawingInput(input)) {
        if (state.items.some(item => item.id === input.id)) return result();
        if (state.items.length >= 20) throw new HttpError('This room has 20 drawings. Remove one before adding another.', 409);
        const chosen = room.highlight_state?.colors?.[seat - 1] ?? -1;
        const partner = room.highlight_state?.colors?.[seat === 1 ? 1 : 0] ?? -1;
        const colorIndex = chosen >= 0 ? chosen : [seat === 1 ? 0 : 3, ...HIGHLIGHT_COLORS.map((_, i) => i)].find(i => i !== partner)!;
        const color = HIGHLIGHT_COLORS[colorIndex];
        const drawing: Drawing = { id: input.id, cfi: input.cfi, anchor: [input.anchor[0], input.anchor[1]],
          page: { width: input.page.width, height: input.page.height, runs: input.page.runs.map(run => ({
            text: run.text, x: run.x, y: run.y, width: run.width, height: run.height, family: run.family,
            size: run.size, weight: run.weight, style: run.style, color: run.color,
          })) }, strokes: input.strokes.map(stroke => ({ width: stroke.width, points: stroke.points.map(point => [point[0], point[1]]) })), color, seat };
        next.items = [...state.items, drawing];
        if (JSON.stringify(next).length > 1500000) throw new HttpError('This room has reached its drawing storage limit.', 413);
      } else {
        const id = (input as { id: string }).id;
        const existing = state.items.find(item => item.id === id);
        if (!existing) return result();
        if (existing.seat !== seat) throw new HttpError('You can only remove your own drawings.', 403);
        next.items = state.items.filter(item => item.id !== id);
      }
      let query = db.from('reading_rooms').update({ drawing_state: next }).eq('code', code).eq('drawing_state->>revision', String(state.revision));
      if (linked) query = query.eq(control.hashColumn, who.controlHash).eq(control.versionColumn, control.version);
      const { data: saved, error: updateError } = await query.select('code').maybeSingle();
      if (updateError) throw updateError;
      if (saved) return NextResponse.json(next, { headers: { 'Cache-Control': 'no-store' } });
    }
    throw new HttpError('Your partner is saving too. Please try again.', 409);
  } catch (error) { return fail(error); }
}
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
