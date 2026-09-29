import * as Sentry from "@sentry/node";
import { randomUUID } from "node:crypto";
import { after } from "next/server.js";

export type ErrorContext = { operation: string; route: string; status?: number };
const routes = new Set(["/api/rooms", "/api/rooms/[code]", "/api/rooms/[code]/state", "/api/rooms/[code]/color", "/api/rooms/[code]/highlights", "/api/rooms/[code]/drawings", "/api/profile", "/api/profile/link", "/api/cron/room-maintenance"]);
const operations = new Set(["room-operation", "create-room", "enter-room", "read-progress", "save-progress", "profile", "link-profile", "room-color", "room-highlights", "room-drawings", "unhandled-request", "maintenance-config", "maintenance-storage", "maintenance-release", "maintenance-delete", "maintenance"]);
const safeLabel = (value: unknown) => typeof value === "string" && operations.has(value) ? value : "server-error";
const safeRelease = () => /^[a-f0-9]{7,40}$/.test(process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA || "") ? process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA : "local";
const safeEnvironment = () => ["production", "preview", "development"].includes(process.env.VERCEL_ENV || "")
  ? process.env.VERCEL_ENV : process.env.NODE_ENV === "production" ? "production" : "development";

// Rebuild rather than redact: unknown fields (including future SDK additions)
// never cross the reporting boundary. No original exceptions or stack traces.
export function safeErrorEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent | null {
  const tags = event.tags;
  if (!tags || tags.source !== "read-together-server") return null;
  const operation = safeLabel(tags.operation), route = routes.has(String(tags.route)) ? String(tags.route) : "server";
  const status = Number(tags.status);
  return { type: undefined, event_id: /^[a-f0-9]{32}$/.test(event.event_id || "") ? event.event_id : undefined,
    level: "error", message: `Read together: ${operation} failed`, platform: "node",
    release: safeRelease(), environment: safeEnvironment(),
    tags: { source: "read-together-server", operation, route, status: Number.isInteger(status) && status >= 500 && status <= 599 ? String(status) : "503" },
    fingerprint: ["read-together-server", operation, route],
  };
}
let initialized = false;
export function initializeErrorReporting() {
  if (initialized || !process.env.SENTRY_DSN) return;
  initialized = true;
  try {
    Sentry.init({ dsn: process.env.SENTRY_DSN, defaultIntegrations: false, dataCollection: { userInfo: false }, enableRuntimeChannelInjection: false,
      maxBreadcrumbs: 0, sendClientReports: false,
      beforeSend: safeErrorEvent, release: safeRelease() });
  } catch { /* Reporting never prevents application startup. */ }
}
const groups = new Map<string, { until: number; id: string }>();
export async function drainErrorReports() {
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([Sentry.flush(1000), new Promise<boolean>(resolve => { deadline = setTimeout(() => resolve(false), 1000); })]); }
  catch { return false; }
  finally { clearTimeout(deadline); }
}
export function reportServerError(context: ErrorContext): string {
  const id = randomUUID().replaceAll("-", "");
  const event = safeErrorEvent({ type: undefined, event_id: id, tags: { source: "read-together-server", ...context, status: String(context.status ?? 503) } })!;
  const group = event.fingerprint!.join(":");
  const now = Date.now(), previous = groups.get(group);
  if (previous && previous.until > now) return previous.id;
  if (groups.size >= 100) groups.clear();
  groups.set(group, { until: now + 60000, id });
  console.error(JSON.stringify({ errorId: id, ...event.tags, release: event.release }));
  initializeErrorReporting();
  // captureEvent queues transport; no API response waits for delivery.
  try {
    if (process.env.SENTRY_DSN) {
      Sentry.captureEvent(event);
      after(drainErrorReports);
    }
  } catch { /* Best effort only. */ }
  return id;
}
