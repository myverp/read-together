import { test } from "node:test";
import assert from "node:assert/strict";
import { createPresenceConnection } from "../src/lib/presence-connection.ts";

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function setup(t, overrides = {}) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const channels = [], statuses = [], removed = [], synced = [];
  let position = { cfi: "epubcfi(/6/2!/4/2:0)", section: "Page 1", done: false };
  let online = true;
  const options = {
    previousRemoval: Promise.resolve(),
    createChannel() {
      const channel = {
        sent: [], outcomes: [], tornDown: 0, events: {},
        on(type, { event }, callback) { this.events[`${type}:${event}`] = callback; return this; },
        subscribe(callback) { this.status = callback; return this; },
        track(payload) {
          this.sent.push(payload);
          const outcome = this.outcomes.shift() ?? "ok";
          return typeof outcome === "function" ? outcome() : Promise.resolve(outcome);
        },
        send() { return Promise.resolve("ok"); },
        teardown() { this.tornDown++; },
      };
      channels.push(channel);
      return channel;
    },
    async removeChannel(channel) { removed.push(channel); channel.status("CLOSED"); channel.teardown(); return "ok"; },
    getPosition: () => position,
    isOnline: () => online,
    onStatus: status => statuses.push(status),
    onUnavailable() {},
    onSync: channel => synced.push(channel),
    onHighlightsChanged() {},
    ...overrides,
  };
  const session = createPresenceConnection(options);
  t.after(() => session.stop());
  return {
    session, options, channels, statuses, removed, synced,
    setPosition: value => { position = value; },
    setOnline: value => { online = value; },
    tick: async ms => { t.mock.timers.tick(ms); await flush(); },
  };
}

test("failed initial tracks back off exponentially, cap at 30s, and reset after acknowledged recovery", async t => {
  const f = setup(t);
  await flush();
  for (const [index, delay] of [1000, 2000, 4000, 8000, 16000, 30000, 30000].entries()) {
    const channel = f.channels.at(-1);
    channel.outcomes.push(index % 3 === 0 ? "error" : index % 3 === 1 ? "timed out" : () => Promise.reject(new Error("Network failure")));
    channel.status("SUBSCRIBED");
    await flush();
    assert.equal(f.statuses.at(-1), "Reconnecting…");
    assert.equal(f.statuses.includes("Live"), false);
    f.session.reconnect(); f.session.reconnect(); channel.status("CHANNEL_ERROR");
    await f.tick(delay - 1);
    assert.equal(f.channels.length, index + 1);
    await f.tick(1);
    assert.equal(f.channels.length, index + 2);
  }
  const recovered = f.channels.at(-1);
  const ack = deferred();
  recovered.outcomes.push(() => ack.promise);
  recovered.status("SUBSCRIBED");
  f.session.reconnect(); f.session.reconnect();
  await f.tick(30000);
  assert.equal(f.channels.length, 8);
  assert.equal(f.statuses.at(-1), "Reconnecting…");
  ack.resolve("ok"); await flush();
  assert.equal(f.statuses.at(-1), "Live");
  recovered.status("TIMED_OUT"); await flush();
  await f.tick(999); assert.equal(f.channels.length, 8);
  await f.tick(1); assert.equal(f.channels.length, 9);
});

test("a normal publication failure reconnects and restores the latest local position", async t => {
  const f = setup(t);
  await flush();
  const first = f.channels[0];
  first.status("SUBSCRIBED"); await flush();
  assert.equal(f.statuses.at(-1), "Live");
  first.outcomes.push("timed out");
  f.setPosition({ cfi: "next", section: "Page 2", done: false });
  f.session.publish(); f.session.publish();
  await f.tick(250);
  assert.equal(first.sent.length, 2);
  assert.equal(f.statuses.at(-1), "Reconnecting…");
  const newest = { cfi: "newest", section: "Page 3", done: true };
  f.setPosition(newest); f.session.publish();
  await f.tick(1000);
  f.channels[1].status("SUBSCRIBED"); await flush();
  assert.deepEqual(f.channels[1].sent, [newest]);
  assert.equal(f.statuses.at(-1), "Live");
});

test("publications never overlap and an update during track is sent afterwards", async t => {
  const f = setup(t); await flush();
  const first = f.channels[0], ack = deferred();
  first.outcomes.push(() => ack.promise);
  first.status("SUBSCRIBED"); first.status("SUBSCRIBED");
  const newest = { cfi: "latest", section: "Latest", done: true };
  f.setPosition(newest); f.session.publish();
  await f.tick(250);
  assert.equal(first.sent.length, 1);
  ack.resolve("ok"); await flush();
  await f.tick(250);
  assert.equal(first.sent.length, 2);
  assert.deepEqual(first.sent[1], newest);
});

test("cleanup is awaited; duplicate events and stale track callbacks cannot create a second reconnect", async t => {
  const cleanup = deferred();
  const f = setup(t, { removeChannel: () => cleanup.promise });
  await flush();
  const first = f.channels[0], stale = deferred();
  first.outcomes.push(() => stale.promise);
  first.status("SUBSCRIBED"); first.status("CHANNEL_ERROR");
  f.session.reconnect(); first.status("CLOSED");
  await f.tick(1000);
  f.session.reconnect(); f.session.reconnect();
  assert.equal(f.channels.length, 1);
  cleanup.resolve("ok"); await flush();
  assert.equal(f.channels.length, 2);
  f.channels[1].status("SUBSCRIBED"); await flush();
  const count = f.statuses.length;
  stale.resolve("error"); first.status("TIMED_OUT"); first.events["presence:sync"]();
  await flush(); await f.tick(30000);
  assert.equal(f.channels.length, 2);
  assert.equal(f.statuses.length, count);
  assert.equal(f.synced.length, 0);
});

test("offline cancels retries and repeated foreground/online signals cause just one recovery", async t => {
  const f = setup(t); await flush();
  f.channels[0].outcomes.push("error");
  f.channels[0].status("SUBSCRIBED"); await flush();
  f.setOnline(false); f.session.offline(); f.session.publish();
  await f.tick(60000);
  assert.equal(f.channels.length, 1);
  assert.equal(f.statuses.at(-1), "Offline · position saved on this device");
  f.setOnline(true); f.session.reconnect(); f.session.reconnect();
  await f.tick(2000);
  assert.equal(f.channels.length, 2);
  f.channels[1].status("SUBSCRIBED"); await flush();
  assert.equal(f.statuses.at(-1), "Live");
});

test("stop cancels retries and ignores a pending track rejection", async t => {
  const f = setup(t); await flush();
  const pending = deferred();
  f.channels[0].outcomes.push(() => pending.promise);
  f.channels[0].status("SUBSCRIBED");
  await f.session.stop();
  const count = f.statuses.length;
  pending.reject(new Error("Late failure"));
  f.session.reconnect(); f.channels[0].status("CHANNEL_ERROR");
  await flush(); await f.tick(60000);
  assert.equal(f.channels.length, 1);
  assert.equal(f.statuses.length, count);
});

test("failed channel removal tears down SDK timers and still allows replacement", async t => {
  const f = setup(t, { removeChannel: async () => { throw new Error("Leave failed"); } });
  await flush();
  f.channels[0].status("CHANNEL_ERROR"); await flush();
  assert.equal(f.channels[0].tornDown, 1);
  await f.tick(1000); assert.equal(f.channels.length, 2);
});

test("a new effect waits for the previous effect's cleanup and stop cancels a queued retry", async t => {
  const previous = deferred();
  const f = setup(t, { previousRemoval: previous.promise });
  await flush(); f.session.reconnect(); f.session.reconnect();
  assert.equal(f.channels.length, 0);
  previous.resolve(); await flush();
  assert.equal(f.channels.length, 1);
  f.channels[0].status("CHANNEL_ERROR");
  await f.session.stop();
  await f.tick(60000);
  assert.equal(f.channels.length, 1);
});
