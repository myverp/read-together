import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { admin, fail, HttpError, tokenHash } from "@/lib/server";
import { MAX_EPUB_BYTES } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const hash = tokenHash(request);
    const { name, size } = await request.json();
    if (typeof name !== "string" || !name.toLowerCase().endsWith(".epub") || name.length > 200 ||
        !Number.isInteger(size) || size <= 0 || size > MAX_EPUB_BYTES) throw new HttpError("Choose an EPUB file up to 25 MB.");
    const db = admin();
    // Bound accidental repeated uploads from the same browser without an account system.
    const { count, error: countError } = await db.from("reading_rooms").select("code", { count: "exact", head: true })
      .eq("reader_one", hash).gte("created_at", new Date(Date.now() - 3600000).toISOString());
    if (countError) throw countError;
    if ((count ?? 0) >= 10) throw new HttpError("Too many rooms created. Try again in an hour.", 429);
    const code = randomBytes(6).toString("hex").toUpperCase();
    const path = `${randomBytes(24).toString("hex")}/book.epub`;
    const { error } = await db.from("reading_rooms").insert({
      code, title: name.replace(/\.epub$/i, ""), book_path: path,
      reader_one: hash, topic: randomBytes(32).toString("hex"),
    });
    if (error) throw error;
    const { data, error: uploadError } = await db.storage.from("epubs").createSignedUploadUrl(path);
    if (uploadError) {
      await db.from("reading_rooms").delete().eq("code", code);
      throw uploadError;
    }
    return NextResponse.json({ code, path, uploadToken: data.token });
  } catch (error) { return fail(error); }
}
