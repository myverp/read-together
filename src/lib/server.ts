import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

export class HttpError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new HttpError("Supabase is not configured. Follow README.md to set up .env.local.", 503);
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function tokenHash(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new HttpError("Missing reader token. Enable browser storage and try again.", 401);
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.headers.get("host")) throw new HttpError("Invalid origin.", 403);
  return createHash("sha256").update(token).digest("hex");
}

export function fail(error: unknown) {
  if (error instanceof HttpError) return NextResponse.json({ error: error.message }, { status: error.status });
  // Do not return database details, signed URLs, or secrets to the browser.
  console.error("Room operation failed:", error instanceof Error ? error.message : "Storage or database error");
  return NextResponse.json({ error: "Room service unavailable. Check Supabase setup and try again." }, { status: 503 });
}

export async function roomResponse(row: { code: string; title: string; topic: string; book_path: string }, seat: number) {
  const { data, error } = await admin().storage.from("epubs").createSignedUrl(row.book_path, 3600);
  if (error) throw error;
  return NextResponse.json({ code: row.code, title: row.title, topic: row.topic, seat, bookUrl: data.signedUrl }, {
    headers: { "Cache-Control": "no-store" },
  });
}
