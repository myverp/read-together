import "server-only";
import { admin } from "./server";
import { completeRoomDeletion } from "./room-deletion";

// Missing Storage objects are already removed. Keep the marked row until
// cleanup succeeds, so a failed request or maintenance can safely retry.
export async function deleteMarkedRoom(db: ReturnType<typeof admin>, code: string, bookPath: string) {
  await completeRoomDeletion({
    removeBook: async () => {
      const { error } = await db.storage.from("epubs").remove([bookPath]);
      if (error) throw error;
    },
    removeRoom: async () => {
      const { error } = await db.from("reading_rooms").delete().eq("code", code).not("deletion_requested_at", "is", null);
      if (error) throw error;
    },
  });
}
