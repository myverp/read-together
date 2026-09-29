import { admin, fail, HttpError } from "@/lib/server";
import { reportServerError } from "@/lib/error-reporting";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return fail(new HttpError("Maintenance is not configured.", 503), { operation: "maintenance-config", route: "/api/cron/room-maintenance" });
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
        reportServerError({ operation: "maintenance-storage", route: "/api/cron/room-maintenance" });
        const { error: releaseError } = await db.from("reading_rooms").update({ cleanup_started_at: null })
          .eq("code", room.code).eq("cleanup_started_at", claimedAt);
        if (releaseError) reportServerError({ operation: "maintenance-release", route: "/api/cron/room-maintenance" });
        continue;
      }
      const { error: deleteError } = await db.from("reading_rooms").delete()
        .eq("code", room.code).eq("ready", false).eq("cleanup_started_at", claimedAt);
      if (deleteError) {
        failed++;
        reportServerError({ operation: "maintenance-delete", route: "/api/cron/room-maintenance" });
        const { error: releaseError } = await db.from("reading_rooms").update({ cleanup_started_at: null })
          .eq("code", room.code).eq("cleanup_started_at", claimedAt);
        if (releaseError) reportServerError({ operation: "maintenance-release", route: "/api/cron/room-maintenance" });
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
    return fail(error, { operation: "maintenance", route: "/api/cron/room-maintenance" });
  }
}
