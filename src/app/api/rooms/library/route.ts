import { admin, fail, HttpError, identity } from "@/lib/server";
import { LIBRARY_COLUMNS, linkedRoomPage, roomMetadata } from "@/lib/room-library-server";
export async function GET(request: Request) {
  try {
    const who = await identity(request);
    const after = new URL(request.url).searchParams.get("after");
    if (after !== null && !/^[A-F0-9]{12}$/.test(after)) throw new HttpError("Invalid room page.");
    return Response.json(await linkedRoomPage(who, after), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error, { operation: "list-linked-rooms", route: "/api/rooms/library" }); }
}
export async function POST(request: Request) {
  try {
    const who = await identity(request); const body = await request.json();
    if (!Array.isArray(body.codes) || body.codes.length > 100 || body.codes.some((code: unknown) => typeof code !== "string" || !/^[A-F0-9]{12}$/.test(code))) throw new HttpError("Request up to 100 valid room codes.");
    const codes = [...new Set<string>(body.codes)];
    if (!codes.length) return Response.json({ rooms: [], unavailable: [] }, { headers: { "Cache-Control": "no-store" } });
    const { data, error } = await admin().from("reading_rooms").select(LIBRARY_COLUMNS).in("code", codes);
    if (error) throw error;
    const rooms = (data || []).map(room => roomMetadata(room, who)).filter(room => room !== null);
    const available = new Set(rooms.map(room => room.code));
    return Response.json({ rooms, unavailable: codes.filter(code => !available.has(code)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error, { operation: "list-browser-rooms", route: "/api/rooms/library" }); }
}
