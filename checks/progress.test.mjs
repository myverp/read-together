import test from 'node:test';
import assert from 'node:assert/strict';
import { createProgressQueue, retryDelay } from '../src/lib/progress-queue.ts';
import { browserStorage, readPending, readPosition, saveProgress, clearPending } from '../src/lib/local-progress.ts';
const position = n => ({ cfi: `epubcfi(/6/2!/4/2/1:${n})`, section: `Page ${n}`, done: false });
const settle = () => new Promise(resolve => setImmediate(resolve));
function harness(overrides = {}) {
  const timers = new Map(); let id = 0; const writes = [], local = [], statuses = [];
  const queue = createProgressQueue({ revision: 3, controlVersion: 2, online: () => true,
    send: async pending => { writes.push(pending); return { position: pending.position, revision: pending.revision + 1 }; },
    read: async () => ({ active: true, revision: 4, me: position(1) }),
    local: value => local.push(value), status: value => statuses.push(value), lostControl: () => {}, random: () => .5,
    schedule: (fn, delay) => { const key = ++id; timers.set(key, { fn, delay }); return key; },
    cancel: key => timers.delete(key), ...overrides });
  return { queue, timers, writes, local, statuses, async tick() { const [key, timer] = timers.entries().next().value; timers.delete(key); timer.fn(); await settle(); return timer.delay; } };
}
test('retry classification: six backoffs, Retry-After and terminal statuses', () => {
  assert.deepEqual(Array.from({ length: 6 }, (_, n) => retryDelay({ status: 503 }, n, () => .5)), [1000,2000,4000,8000,16000,30000]);
  assert.equal(retryDelay({ status: 503 }, 6), null);
  assert.equal(retryDelay({ status: 429, retryAfterMs: 45000 }, 0, () => .5), 45000);
  for (const status of [400,401,403,404,409,410]) assert.equal(retryDelay({ status }, 0), null);
  assert.equal(retryDelay({}, 0, () => .5), 1000);
});
test('polls, updates and flush cannot bypass retry pauses or reset retry limit', async () => {
  let attempts = 0; const h = harness({ send: async () => { attempts++; throw { status: 503 }; } });
  h.queue.update(position(1)); await h.tick();
  for (let retry = 0; retry < 6; retry++) {
    h.queue.update(position(retry + 2)); h.queue.kick(); await h.queue.flush(10);
    assert.equal(attempts, retry + 1); assert.equal(h.timers.size, 1); await h.tick();
  }
  assert.equal(attempts, 7); assert.equal(h.timers.size, 0);
  h.queue.kick(); h.queue.update(position(20)); await settle(); assert.equal(attempts, 7);
  h.queue.retry(); await settle(); assert.equal(attempts, 8); h.queue.stop(); assert.equal(h.timers.size, 0);
});
test('one active write retains only latest next position; old success cannot clear it', async () => {
  let resolve; const writes = []; const h = harness({ send: pending => { writes.push(pending); return new Promise(done => { resolve = done; }); } });
  h.queue.update(position(1)); await h.tick(); h.queue.update(position(2)); h.queue.update(position(3));
  assert.equal(writes.length, 1); resolve({ position: position(1), revision: 4 }); await settle();
  assert.equal(writes.length, 2); assert.deepEqual(writes[1].position, position(3)); assert.equal(writes[1].revision, 4);
  assert.ok(h.local.at(-1)); resolve({ position: position(3), revision: 5 }); await settle();
  assert.equal(h.queue.hasPending(), false); assert.equal(h.local.at(-1), null); assert.equal(h.statuses.at(-1), 'Synced'); h.queue.stop();
});
test('exit flush bypasses debounce and includes an active unanswered request in its deadline', async () => {
  const healthy = harness(); healthy.queue.update(position(1)); assert.equal(await healthy.queue.flush(100), true); assert.equal(healthy.writes.length, 1); assert.equal(healthy.timers.size, 0);
  const hung = harness({ send: () => new Promise(() => {}) }); hung.queue.update(position(1));
  const start = Date.now(); assert.equal(await hung.queue.flush(30), false); assert.ok(Date.now() - start < 250); assert.equal(hung.queue.hasPending(), true); hung.queue.stop(); healthy.queue.stop();
});
test('stopped session aborts requests and ignores their late success callbacks', async () => {
  let resolve, signal; const h = harness({ send: (_pending, current) => { signal = current; return new Promise(done => { resolve = done; }); } });
  h.queue.update(position(1)); await h.tick(); const count = h.local.length; h.queue.stop(); assert.equal(signal.aborted, true);
  resolve({ position: position(1), revision: 4 }); await settle(); assert.equal(h.local.length, count); assert.equal(h.timers.size, 0);
});
test('lost response reconciles same cloud position; different position needs explicit choice', async () => {
  const h = harness({ send: async () => { throw { status: 409, details: { code: 'revision_conflict' } }; } });
  h.queue.update(position(1)); await h.tick(); assert.equal(h.queue.hasPending(), false); assert.equal(h.statuses.at(-1), 'Synced'); h.queue.stop();
  const conflict = harness({ send: async () => { throw { status: 409, details: { code: 'revision_conflict' } }; } });
  conflict.queue.update(position(2)); await conflict.tick(); assert.equal(conflict.statuses.at(-1), 'Choose which position to keep'); conflict.queue.retry(); await settle(); assert.equal(conflict.timers.size, 0);
  assert.deepEqual(conflict.queue.useCloud(), position(1)); assert.equal(conflict.queue.hasPending(), false); conflict.queue.stop();
});
test('takeover takes precedence over revision conflicts; terminal auth needs manual retry', async () => {
  let lost = 0; const h = harness({ send: async () => { throw { status: 409, details: { takenOver: true, code: 'revision_conflict' } }; }, lostControl: () => lost++ });
  h.queue.update(position(1)); await h.tick(); assert.equal(lost, 1); assert.equal(h.timers.size, 0); h.queue.retry(); await settle(); assert.equal(lost, 1);
  const auth = harness({ send: async () => { throw { status: 401 }; } }); auth.queue.update(position(1)); await auth.tick(); assert.equal(auth.statuses.at(-1), 'Sign in again to sync'); assert.equal(auth.timers.size, 0); auth.queue.stop();
});
test('synchronous send failure still releases the active-write lock', async () => {
  let attempts = 0; const h = harness({ send: () => { attempts++; throw { status: 503 }; } }); h.queue.update(position(1)); await h.tick(); await h.tick(); assert.equal(attempts, 2); h.queue.stop();
});
test('legacy position stays readable; invalid pending and blocked/full storage are safe', () => {
  const values = new Map(); const storage = { getItem: key => values.get(key) ?? null, setItem: (key,value) => values.set(key,value), removeItem: key => values.delete(key) };
  const pending = { format: 1, position: position(2), revision: 3, controlVersion: 2 };
  assert.equal(saveProgress(storage, 'room', position(2), pending), true); assert.deepEqual(readPosition(storage,'room'), position(2)); assert.deepEqual(readPending(storage,'room'), pending);
  values.set('room:pending','{"format":1,"position":null}'); assert.equal(readPending(storage,'room'), null);
  values.set('room:pending','{broken'); assert.equal(readPending(storage,'room'), null); assert.equal(clearPending(storage,'room'), true);
  const blocked = { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('full'); }, removeItem: () => { throw Error('blocked'); } };
  assert.equal(readPending(blocked,'room'), null); assert.equal(saveProgress(blocked,'room',position(1),pending), false); assert.equal(clearPending(blocked,'room'), false);
  assert.equal(saveProgress(null,'room',position(1)), false);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { get localStorage() { throw Error('SecurityError'); } } }); assert.equal(browserStorage(), null); delete globalThis.window;
});
