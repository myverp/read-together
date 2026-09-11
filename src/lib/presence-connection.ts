import type { RealtimeChannel } from "@supabase/supabase-js";
import type { Position } from "./types";

type Options = {
  createChannel: () => RealtimeChannel;
  removeChannel: (channel: RealtimeChannel) => Promise<unknown>;
  previousRemoval: Promise<void>;
  getPosition: () => Position;
  isOnline: () => boolean;
  onStatus: (status: string) => void;
  onUnavailable: () => void;
  onSync: (channel: RealtimeChannel) => void;
  onHighlightsChanged: () => void;
};

const OFFLINE = "Offline · position saved on this device";

/** One owner for subscription, publication, retry timers, and channel retirement. */
export function createPresenceConnection(options: Options) {
  let stopped = false;
  let active: RealtimeChannel | null = null;
  let connecting = false;
  let subscribed = false;
  let ready = false;
  let tracking: RealtimeChannel | null = null;
  let generation = 0;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let publishTimer: ReturnType<typeof setTimeout> | undefined;
  let removal = options.previousRemoval;

  const current = (channel: RealtimeChannel) => !stopped && active === channel;

  function retire() {
    generation++;
    const old = active;
    active = null; subscribed = false; connecting = false; ready = false; tracking = null;
    clearTimeout(publishTimer); publishTimer = undefined;
    if (!old) return;
    // Invalidate callbacks before unsubscribe, which can itself emit CLOSED.
    removal = removal.then(async () => {
      try {
        const result = await options.removeChannel(old);
        if (result !== "ok") old.teardown();
      } catch { old.teardown(); }
    });
  }

  function offline() {
    if (stopped) return;
    clearTimeout(retryTimer); retryTimer = undefined;
    retire();
    options.onUnavailable();
    options.onStatus(OFFLINE);
  }

  function retry() {
    if (stopped || retryTimer !== undefined) return;
    if (!options.isOnline()) { offline(); return; }
    retire();
    options.onUnavailable();
    options.onStatus("Reconnecting…");
    // Reset only after the replacement channel successfully publishes Presence.
    const delay = Math.min(1000 * 2 ** attempt, 30000);
    attempt = Math.min(attempt + 1, 5);
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      void connect();
    }, delay);
  }

  async function track(channel: RealtimeChannel) {
    if (!current(channel) || !subscribed || tracking === channel) return;
    tracking = channel;
    const position = options.getPosition();
    let result: string;
    try { result = await channel.track(position, { timeout: 5000 }); }
    catch { result = "error"; }
    if (tracking === channel) tracking = null;
    if (!current(channel)) return;
    if (result !== "ok") { retry(); return; }
    attempt = 0;
    options.onStatus("Live");
    if (!ready) { ready = true; options.onHighlightsChanged(); }
    // A page turn while track was in flight must still reach the partner.
    if (options.getPosition() !== position) publish();
  }

  function publish() {
    if (stopped || !active || !subscribed) return;
    clearTimeout(publishTimer);
    publishTimer = setTimeout(() => {
      publishTimer = undefined;
      if (active) void track(active);
    }, 250);
  }

  async function connect() {
    if (stopped || connecting || active) return;
    if (!options.isOnline()) { offline(); return; }
    connecting = true;
    const version = ++generation;
    await removal;
    if (stopped || version !== generation) return;
    if (!options.isOnline()) { offline(); return; }
    try {
      const channel = options.createChannel();
      active = channel;
      channel.on("broadcast", { event: "highlights-changed" }, () => {
        if (current(channel)) options.onHighlightsChanged();
      });
      channel.on("presence", { event: "sync" }, () => {
        if (current(channel)) options.onSync(channel);
      });
      channel.subscribe(status => {
        if (!current(channel)) return;
        if (status === "SUBSCRIBED") {
          connecting = false; subscribed = true;
          void track(channel);
        } else { retry(); }
      }, 5000);
    } catch { retry(); }
  }

  options.onStatus(options.isOnline() ? "Connecting…" : OFFLINE);
  void connect();

  return {
    publish,
    offline,
    reconnect() {
      // Online + visibility events frequently arrive together on mobile.
      if (!stopped && !connecting && (ready || !active) && retryTimer === undefined) retry();
    },
    notifyHighlights() {
      if (!subscribed) return;
      void active?.send({ type: "broadcast", event: "highlights-changed", payload: {} }).catch(() => {
        // Durable highlights are recovered by the recipient's fallback fetch.
      });
    },
    stop() {
      stopped = true;
      clearTimeout(retryTimer); retryTimer = undefined;
      retire();
      return removal;
    },
  };
}
