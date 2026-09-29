import { createClient } from "@supabase/supabase-js";
let client: ReturnType<typeof createClient> | undefined;
export function supabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase is not configured. Follow README.md to set up .env.local.");
  return client ??= createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
}

export function readerToken() {
  let token = localStorage.getItem("read-together:token");
  if (!token) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    token = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem("read-together:token", token);
  }
  return token;
}

export class ApiError extends Error {
  status?: number;
  details?: { code?: string; takenOver?: boolean; takeoverRequired?: boolean; errorId?: string };
  retryAfterMs?: number;
}
export async function api<T>(path: string, body?: unknown, method = "POST", options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<T> {
  const signal = AbortSignal.any([AbortSignal.timeout(options.timeoutMs ?? 30000), ...(options.signal ? [options.signal] : [])]);
  // Header/session resolution is also part of the request's deadline.
  const headers = await Promise.race([apiHeaders(), new Promise<never>((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  })]);
  const response = await fetch(path, {
    method, headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  let result;
  try { result = await response.json(); } catch { result = null; }
  if (!response.ok) {
    const error = new ApiError(typeof result?.error === "string" ? result.error : `Request failed (${response.status}). Please try again.`);
    error.status = response.status; error.details = result;
    const retryAfter = response.headers.get("Retry-After");
    if (retryAfter) error.retryAfterMs = /^\d+(\.\d+)?$/.test(retryAfter) ? Number(retryAfter) * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now()) || undefined;
    throw error;
  }
  if (result === null) throw new ApiError("The service returned an unreadable response. Please try again.");
  return result;
}

export async function apiHeaders(extra: Record<string, string> = {}) {
  const { data } = await supabase().auth.getSession();
  const browserToken = readerToken();
  return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${data.session?.access_token || browserToken}`,
      "X-Reader-Token": browserToken,
      ...extra,
  };
}
