import { samePosition, type PendingProgress } from "./local-progress.ts";
import type { Position } from "./types.ts";

export type SyncState = "Synced" | "Syncing…" | "Waiting for connection" | "Could not sync" | "Sign in again to sync" | "Choose which position to keep";
type Failure = { status?: number; retryAfterMs?: number; details?: { code?: string; takenOver?: boolean } };
export function retryDelay(error: Failure, retry: number, random = Math.random): number | null {
  if (retry >= 6 || (error.status !== undefined && error.status !== 429 && error.status < 500)) return null;
  const backoff = [1000, 2000, 4000, 8000, 16000, 30000][retry] * (0.9 + random() * 0.2);
  return Math.max(backoff, error.retryAfterMs || 0);
}

// This queue owns every write trigger. A poll/page turn never bypasses backoff.
export function createProgressQueue(options: {
  revision: number; controlVersion: number;
  send: (pending: PendingProgress, signal: AbortSignal) => Promise<{ revision: number; position: Position }>;
  read: (signal: AbortSignal) => Promise<{ active: boolean; revision: number; me: Position }>;
  online: () => boolean; local: (pending: PendingProgress | null) => void;
  status: (state: SyncState) => void; lostControl: () => void;
  schedule?: typeof setTimeout; cancel?: typeof clearTimeout; random?: () => number;
}) {
  const schedule = options.schedule || setTimeout, cancel = options.cancel || clearTimeout;
  let pending: PendingProgress | null = null, revision = options.revision, retries = 0;
  let timer: ReturnType<typeof setTimeout> | null = null, active: Promise<void> | null = null;
  let timerKind: "debounce" | "retry" | null = null;
  let disposed = false, blocked = false, controller: AbortController | null = null;
  let conflict: { revision: number; me: Position } | null = null;
  const stopTimer = () => { if (timer !== null) cancel(timer); timer = null; timerKind = null; };
  const publishPending = () => { if (pending) pending = { ...pending, revision }; options.local(pending); };
  const kick = () => {
    if (disposed || active || timer !== null || blocked || !pending) return;
    if (!options.online()) { options.status("Waiting for connection"); return; }
    const sent = { ...pending, revision }; controller = new AbortController();
    options.status("Syncing…");
    active = Promise.resolve().then(async () => {
      try {
        const saved = await options.send(sent, controller!.signal);
        if (disposed) return;
        revision = saved.revision; retries = 0;
        if (pending && samePosition(pending.position, sent.position)) pending = null;
        publishPending(); options.status(pending ? "Syncing…" : "Synced");
      } catch (reason) {
        if (disposed) return;
        const error = reason as Failure;
        if (error.details?.takenOver) { api.stop(); options.lostControl(); return; }
        if (error.details?.code === "revision_conflict") {
          try {
            const state = await options.read(controller!.signal);
            if (disposed) return;
            if (!state.active) { api.stop(); options.lostControl(); return; }
            if (samePosition(state.me, sent.position)) {
              revision = state.revision; retries = 0;
              if (pending && samePosition(pending.position, sent.position)) pending = null;
              publishPending(); options.status(pending ? "Syncing…" : "Synced"); return;
            }
            conflict = state; blocked = true; options.status("Choose which position to keep"); return;
          } catch { /* Resolve on an explicit retry if the conflict read fails. */ }
          blocked = true; options.status("Could not sync"); return;
        }
        const delay = retryDelay(error, retries, options.random);
        if (delay === null) { blocked = true; options.status(error.status === 401 ? "Sign in again to sync" : "Could not sync"); }
        else { retries++; options.status(options.online() ? "Could not sync" : "Waiting for connection"); timerKind = "retry"; timer = schedule(() => { timer = null; timerKind = null; kick(); }, delay); }
      } finally {
        active = null; controller = null;
        if (!disposed && pending && !blocked && timer === null) kick();
      }
    });
  };
  const api = {
    update(position: Position, debounce = true) {
      if (disposed) return;
      pending = { format: 1, position, controlVersion: options.controlVersion, revision }; publishPending();
      if (timer === null && !active && !blocked && debounce) { timerKind = "debounce"; timer = schedule(() => { timer = null; timerKind = null; kick(); }, 250); }
      else if (!debounce) kick();
    },
    restore(value: PendingProgress) { if (disposed) return; revision = value.revision; pending = value; kick(); },
    kick,
    retry() { if (disposed || conflict) return; retries = 0; blocked = false; stopTimer(); kick(); },
    keepLocal() { if (!conflict || disposed) return; revision = conflict.revision; conflict = null; blocked = false; retries = 0; publishPending(); kick(); },
    useCloud(): Position | null { if (!conflict || disposed) return null; const position = conflict.me; revision = conflict.revision; conflict = null; pending = null; blocked = false; options.local(null); options.status("Synced"); return position; },
    stop() { disposed = true; stopTimer(); controller?.abort(); },
    hasPending: () => !!pending,
    persistLocal: () => { if (pending && !disposed) publishPending(); },
    async flush(budget = 2000) {
      // Respect retry pauses; include any already running request in the budget.
      if (timerKind === "debounce") stopTimer();
      kick();
      let deadline: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        (async () => { while (active) await active; })(),
        new Promise<void>(resolve => { deadline = setTimeout(resolve, budget); }),
      ]);
      clearTimeout(deadline);
      return !pending;
    },
  };
  return api;
}
