import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import type { Position } from "./types";

export class HttpError extends Error {
  constructor(message: string, public status = 400, public details: Record<string, unknown> = {}) { super(message); }
}

export function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new HttpError("Supabase is not configured. Follow README.md to set up .env.local.", 503);
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function hashToken(token: string) { return createHash("sha256").update(token).digest("hex"); }

export type Identity = { user: User | null; userId: string | null; guestHash: string; controlHash: string };
export function occupantHash(who: Identity) { return who.userId ? hashToken(`user:${who.userId}`) : who.guestHash; }

export async function identity(request: Request): Promise<Identity> {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
  const browser = request.headers.get("x-reader-token") || (/^[a-f0-9]{64}$/.test(bearer) ? bearer : "");
  if (!/^[a-f0-9]{64}$/.test(browser)) throw new HttpError("Missing reader token. Enable browser storage and try again.", 401);
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.headers.get("host")) throw new HttpError("Invalid origin.", 403);
  if (/^[a-f0-9]{64}$/.test(bearer)) return { user: null, userId: null, guestHash: hashToken(browser), controlHash: hashToken(browser) };
  if (!bearer) throw new HttpError("Sign in again.", 401);
  const { data, error } = await admin().auth.getUser(bearer);
  if (error || !data.user) throw new HttpError("Your sign-in expired. Sign in again.", 401);
  return { user: data.user, userId: data.user.id, guestHash: hashToken(browser), controlHash: hashToken(browser) };
}

export async function tokenHash(request: Request) { return (await identity(request)).guestHash; }

type RoomSeatRow = {
  reader_one: string; reader_two: string | null; reader_one_user: string | null; reader_two_user: string | null;
  control_hash_one: string | null; control_hash_two: string | null; control_version_one: number; control_version_two: number;
};
export function seatFor(room: RoomSeatRow, who: Identity): 1 | 2 | null {
  if (who.userId && room.reader_one_user === who.userId) return 1;
  if (who.userId && room.reader_two_user === who.userId) return 2;
  if (!room.reader_one_user && room.reader_one === who.guestHash) return 1;
  if (!room.reader_two_user && room.reader_two === who.guestHash) return 2;
  return null;
}
export function controlFor(room: RoomSeatRow, seat: 1 | 2) {
  return seat === 1
    ? { hash: room.control_hash_one, version: Number(room.control_version_one), hashColumn: "control_hash_one", versionColumn: "control_version_one", positionColumn: "position_one" }
    : { hash: room.control_hash_two, version: Number(room.control_version_two), hashColumn: "control_hash_two", versionColumn: "control_version_two", positionColumn: "position_two" };
}

export async function ensureProfile(who: Identity) {
  if (!who.userId || !who.user) throw new HttpError("Sign in to use a profile.", 401);
  const db = admin();
  const { data: existing, error } = await db.from("profiles").select("*").eq("user_id", who.userId).maybeSingle();
  if (error) throw error;
  if (existing) return existing;
  const fallback = (who.user.email?.split("@")[0] || "Reader").replace(/[^\p{L}\p{N} _.-]/gu, "").slice(0, 40) || "Reader";
  const { data, error: insertError } = await db.from("profiles").insert({ user_id: who.userId, name: fallback }).select("*").single();
  if (insertError) throw insertError;
  return data;
}

export function fail(error: unknown) {
  if (error instanceof HttpError) return NextResponse.json({ error: error.message, ...error.details }, { status: error.status });
  // Do not return database details, signed URLs, or secrets to the browser.
  console.error("Room operation failed:", error instanceof Error ? error.message : "Storage or database error");
  return NextResponse.json({ error: "Room service unavailable. Check Supabase setup and try again." }, { status: 503 });
}

export async function roomResponse(row: { code: string; title: string; topic: string; book_path: string; position_one?: Position; position_two?: Position; control_version_one?: number; control_version_two?: number; highlight_state?: { colors?: number[] } }, seat: 1 | 2) {
  const { data, error } = await admin().storage.from("epubs").createSignedUrl(row.book_path, 3600);
  if (error) throw error;
  return NextResponse.json({ code: row.code, title: row.title, topic: row.topic, seat, bookUrl: data.signedUrl,
    me: seat === 1 ? row.position_one : row.position_two,
    partner: seat === 1 ? row.position_two : row.position_one,
    controlVersion: seat === 1 ? row.control_version_one : row.control_version_two,
    color: row.highlight_state?.colors?.[seat - 1] ?? -1,
    partnerColor: row.highlight_state?.colors?.[seat === 1 ? 1 : 0] ?? -1,
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}
