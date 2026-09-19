import { admin, ensureProfile, fail, HttpError, identity } from "@/lib/server";
import { AVATARS } from "@/lib/types";

function response(profile: Record<string, unknown>, email?: string) {
  return { userId: profile.user_id, email, name: profile.name, avatar: profile.avatar, preferredColor: profile.preferred_color };
}

export async function GET(request: Request) {
  try {
    const who = await identity(request); const profile = await ensureProfile(who);
    const db = admin();
    const { data, error } = await db.from("reading_rooms")
      .select("code,title,created_at,reader_one_user,reader_two_user,highlight_state")
      .or(`reader_one_user.eq.${who.userId},reader_two_user.eq.${who.userId}`).order("created_at", { ascending: false }).limit(50);
    if (error) throw error;
    const rooms = (data || []).map(room => {
      const seat = room.reader_one_user === who.userId ? 1 : 2;
      const colors = (room.highlight_state as { colors?: number[] })?.colors || [-1, -1];
      return { code: room.code, title: room.title, seat, createdAt: room.created_at, color: colors[seat - 1] ?? -1 };
    });
    return Response.json({ profile: response(profile, who.user?.email), rooms }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error); }
}

export async function PATCH(request: Request) {
  try {
    const who = await identity(request); await ensureProfile(who);
    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 40) throw new HttpError("Use a name between 1 and 40 characters.");
    if (!AVATARS.includes(body.avatar)) throw new HttpError("Choose one of the available avatars.");
    if (!Number.isInteger(body.preferredColor) || body.preferredColor < 0 || body.preferredColor > 9) throw new HttpError("Choose an available highlight color.");
    const { data, error } = await admin().from("profiles").update({ name, avatar: body.avatar, preferred_color: body.preferredColor, updated_at: new Date().toISOString() })
      .eq("user_id", who.userId!).select("*").single();
    if (error) throw error;
    return Response.json({ profile: response(data, who.user?.email) });
  } catch (error) { return fail(error); }
}
