export async function completeRoomDeletion(operations: {
  removeBook: () => Promise<void>;
  removeRoom: () => Promise<void>;
}) {
  await operations.removeBook();
  await operations.removeRoom();
}
