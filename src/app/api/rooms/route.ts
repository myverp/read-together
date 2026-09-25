import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { admin, ensureProfile, fail, HttpError, identity, occupantHash } from "@/lib/server";
import { MAX_EPUB_BYTES } from "@/lib/types";
import { roomCreationScope } from "@/lib/upload-guard";

export async function POST(request: Request) {
  try {
    const who = await identity(request);
    const { name, size } = await request.json();
    if (typeof name !== "string" || !name.toLowerCase().endsWith(".epub") || name.length > 200 ||
        !Number.isInteger(size) || size <= 0 || size > MAX_EPUB_BYTES) throw new HttpError("Choose an EPUB file up to 25 MB.");
    const db = admin();
    const scope = roomCreationScope(request, who.guestHash, process.env.SUPABASE_SECRET_KEY!, !!process.env.VERCEL);
    if (!scope) throw new HttpError("Could not identify this request. Try again shortly.", 503);
    const code = randomBytes(6).toString("hex").toUpperCase();
    const path = `${randomBytes(24).toString("hex")}/book.epub`;
    const profile = who.userId ? await ensureProfile(who) : null;
    const { data: outcome, error } = await db.rpc("create_reading_room", {
      p_code: code, p_title: name.replace(/\.epub$/i, ""), p_book_path: path,
      p_topic: randomBytes(32).toString("hex"), p_reader_one: occupantHash(who),
      p_reader_one_user: who.userId, p_control_hash_one: who.userId ? who.controlHash : null,
      p_preferred_color: profile?.preferred_color ?? -1, p_scope_hash: scope,
    });
    if (error) throw error;
    if (outcome === "storage_budget") throw new HttpError("Room storage is temporarily full. Try again later.", 503);
    if (outcome === "browser_limit" || outcome === "network_limit") throw new HttpError("Too many rooms created. Try again later.", 429);
    if (outcome !== "ok") throw new Error("Unexpected room creation result");
    const { data, error: uploadError } = await db.storage.from("epubs").createSignedUploadUrl(path);
    if (uploadError) {
      await db.from("reading_rooms").delete().eq("code", code);
      throw uploadError;
    }
    return NextResponse.json({ code, path, uploadToken: data.token });
  } catch (error) { return fail(error); }
}
