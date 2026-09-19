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

export async function api<T>(path: string, body?: unknown, method = "POST"): Promise<T> {
  const headers = await apiHeaders();
  const response = await fetch(path, {
    method, headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error || "Request failed. Please try again.") as Error & { status?: number; details?: unknown };
    error.status = response.status; error.details = result;
    throw error;
  }
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
