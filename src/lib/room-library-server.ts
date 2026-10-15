import "server-only";
import { admin, seatFor, type Identity } from "./server";
export const LIBRARY_PAGE_SIZE = 50;
export const LIBRARY_COLUMNS = "code,title,created_at,reader_one,reader_two,reader_one_user,reader_two_user,archived_at_one,archived_at_two,last_opened_at_one,last_opened_at_two,section_one:position_one->>section,section_two:position_two->>section,ready,cleanup_started_at" as const;
type MetadataRow = {
  code: string; title: string; created_at: string; reader_one: string; reader_two: string | null;
  reader_one_user: string | null; reader_two_user: string | null;
  archived_at_one: string | null; archived_at_two: string | null; last_opened_at_one: string | null; last_opened_at_two: string | null;
  section_one: string | null; section_two: string | null; ready: boolean; cleanup_started_at: string | null;
};
export function roomMetadata(room: MetadataRow, who: Identity) {
  const seat = seatFor(room, who);
  if (!seat || !room.ready || room.cleanup_started_at) return null;
  return { code: room.code, title: room.title, seat, createdAt: room.created_at,
    section: (seat === 1 ? room.section_one : room.section_two) || "",
    archivedAt: seat === 1 ? room.archived_at_one : room.archived_at_two,
    lastOpenedAt: seat === 1 ? room.last_opened_at_one : room.last_opened_at_two,
    linked: !!(who.userId && (seat === 1 ? room.reader_one_user : room.reader_two_user) === who.userId),
  };
}
export async function linkedRoomPage(who: Identity, after: string | null) {
  if (!who.userId) return { rooms: [], nextCursor: null };
  let query = admin().from("reading_rooms").select(LIBRARY_COLUMNS)
    .or(`reader_one_user.eq.${who.userId},reader_two_user.eq.${who.userId}`).eq("ready", true).is("cleanup_started_at", null)
    .order("code").limit(LIBRARY_PAGE_SIZE + 1);
  if (after) query = query.gt("code", after);
  const { data, error } = await query;
  if (error) throw error;
  return { rooms: (data || []).slice(0, LIBRARY_PAGE_SIZE).map(room => roomMetadata(room, who)).filter(room => room !== null),
    nextCursor: data && data.length > LIBRARY_PAGE_SIZE ? data[LIBRARY_PAGE_SIZE - 1].code : null };
}
