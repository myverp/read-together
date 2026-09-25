import { admin } from "@/lib/server";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "Maintenance is not configured." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`)
    return Response.json({ error: "Unauthorized." }, { status: 401 });

  try {
    const db = admin();
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const staleClaim = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: pending, error: listError } = await db.from("reading_rooms")
      .select("code,book_path").eq("ready", false)
      .or(`cleanup_started_at.is.null,cleanup_started_at.lt.${staleClaim}`)
      .lt("created_at", cutoff).limit(100);
    if (listError) throw listError;
    let removed = 0;
    let failed = 0;
    for (const room of pending || []) {
      const claimedAt = new Date().toISOString();
      const { data: claimed, error: claimError } = await db.from("reading_rooms")
        .update({ cleanup_started_at: claimedAt }).eq("code", room.code)
        .eq("ready", false)
        .or(`cleanup_started_at.is.null,cleanup_started_at.lt.${staleClaim}`)
        .select("code").maybeSingle();
      if (claimError) throw claimError;
      if (!claimed) continue;
      const { error: storageError } = await db.storage.from("epubs").remove([room.book_path]);
      if (storageError) {
        failed++;
        console.error("Pending EPUB cleanup failed", storageError.message);
        await db.from("reading_rooms").update({ cleanup_started_at: null })
          .eq("code", room.code).eq("cleanup_started_at", claimedAt);
        continue;
      }
      const { error: deleteError } = await db.from("reading_rooms").delete()
        .eq("code", room.code).eq("ready", false).eq("cleanup_started_at", claimedAt);
      if (deleteError) {
        failed++;
        console.error("Pending room cleanup failed", deleteError.message);
        await db.from("reading_rooms").update({ cleanup_started_at: null })
          .eq("code", room.code).eq("cleanup_started_at", claimedAt);
      } else removed++;
    }
    const { error: pruneError } = await db.from("room_creation_limits").delete()
      .lt("window_start", new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString());
    if (pruneError) throw pruneError;
    const { data, error: usageError } = await db.rpc("room_storage_usage").single();
    if (usageError || !data) throw usageError || new Error("Storage usage is unavailable");
    const usage = data as { stored_bytes: number; pending_bytes: number; budget_bytes: number; room_count: number };
    const report = { removed, failed, pending: pending?.length ?? 0, usage };
    console.info("Room maintenance", report);
    if (Number(usage.stored_bytes) + Number(usage.pending_bytes) > Number(usage.budget_bytes) * 0.8)
      console.warn("Room storage is above 80% of its creation budget", usage);
    return Response.json(report, { status: failed ? 503 : 200 });
  } catch (error) {
    console.error("Room maintenance failed", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "Room maintenance failed." }, { status: 503 });
  }
}
