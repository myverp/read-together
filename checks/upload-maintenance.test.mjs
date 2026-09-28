import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { isolatedBackend } from './local-backend.mjs';
import { epub } from '../tests/epub.ts';

const { url, base } = isolatedBackend();
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const bytes = 26214400;
const token = () => randomBytes(32).toString('hex');
async function checked(result) { const value = await result; assert.equal(value.error, null); return value.data; }
function fixtures(t) {
  const rooms = [], scopes = [];
  t.after(async () => {
    if (rooms.length) {
      await checked(admin.storage.from('epubs').remove(rooms.map(room => room.book_path)));
      await checked(admin.from('reading_rooms').delete().in('code', rooms.map(room => room.code)));
    }
    if (scopes.length) await checked(admin.from('room_creation_limits').delete().in('scope_hash', scopes));
  });
  function room(overrides = {}) {
    const row = { code: randomBytes(6).toString('hex').toUpperCase(), title: 'CI fixture',
      book_path: `${token()}/book.epub`, topic: token(), reader_one: token(), ready: false,
      created_at: new Date().toISOString(), ...overrides };
    rooms.push(row); return row;
  }
  function scope() { const value = token(); scopes.push(value); return value; }
  async function create(row, scopeHash) {
    return checked(admin.rpc('create_reading_room', {
      p_code: row.code, p_title: row.title, p_book_path: row.book_path, p_topic: row.topic,
      p_reader_one: row.reader_one, p_reader_one_user: null, p_control_hash_one: null,
      p_preferred_color: -1, p_scope_hash: scopeHash,
    }));
  }
  return { room, scope, create, rooms };
}
const usage = async () => checked(admin.rpc('room_storage_usage').single());

test('concurrent HTTP room creation admits only the tenth room for a browser', async t => {
  const f = fixtures(t), device = token();
  const reader = createHash('sha256').update(device).digest('hex');
  await checked(admin.from('reading_rooms').insert(Array.from({ length: 9 }, () => f.room({ reader_one: reader, ready: true }))));
  // Track the API-generated scope too, so fixtures leave no counters behind.
  const { createHmac } = await import('node:crypto');
  const scope = createHmac('sha256', process.env.SUPABASE_SECRET_KEY).update(`local:${reader}`).digest('hex');
  t.after(() => checked(admin.from('room_creation_limits').delete().eq('scope_hash', scope)));
  const results = await Promise.all([1, 2].map(async () => {
    const response = await fetch(`${base}/api/rooms`, { method: 'POST',
      headers: { Authorization: `Bearer ${device}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'CI race.epub', size: 100 }), signal: AbortSignal.timeout(30000) });
    const body = await response.json();
    if (response.status === 200) f.rooms.push({ code: body.code, book_path: body.path });
    return { status: response.status, body };
  }));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 429]);
  assert.match(results.find(result => result.status === 429).body.error, /Too many rooms/);
  const rows = await checked(admin.from('reading_rooms').select('code').eq('reader_one', reader));
  assert.equal(rows.length, 10, 'concurrent requests must not bypass the browser cap');
});

for (const [kind, limit] of [['hour', 30], ['day', 100]]) {
  test(`network ${kind} counter admits exactly one concurrent reservation at its limit`, async t => {
    const f = fixtures(t);
    async function databaseWindow() {
      // The RPC inserts created_at with the database's now(), avoiding clock skew.
      const clock = f.room();
      assert.equal(await f.create(clock, f.scope()), 'ok');
      const row = await checked(admin.from('reading_rooms').select('created_at').eq('code', clock.code).single());
      const date = new Date(row.created_at);
      date.setUTCMinutes(0, 0, 0); if (kind === 'day') date.setUTCHours(0);
      return date.toISOString();
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const scope = f.scope(), window = await databaseWindow();
      await checked(admin.from('room_creation_limits').insert({ scope_hash: scope, window_kind: kind, window_start: window, attempts: limit - 1 }));
      const rows = [f.room(), f.room()];
      const results = await Promise.all(rows.map(row => f.create(row, scope)));
      if (await databaseWindow() !== window) {
        assert.equal(attempt, 0, 'database window changed in both bounded attempts');
        continue; // Retry only a confirmed clock boundary, never an assertion failure.
      }
      assert.deepEqual(results.sort(), ['network_limit', 'ok']);
      const counter = await checked(admin.from('room_creation_limits').select('attempts').eq('scope_hash', scope).eq('window_kind', kind).single());
      assert.equal(counter.attempts, limit, 'rejected requests must not increment counters');
      const persisted = await checked(admin.from('reading_rooms').select('code').in('code', rows.map(row => row.code)));
      assert.equal(persisted.length, 1);
      return;
    }
  });
}

test('concurrent pending reservations cannot exceed the 500 MiB budget and deletion releases capacity', async t => {
  const f = fixtures(t);
  const before = await usage();
  assert.equal(Number(before.pending_bytes), 0, 'run serially without other pending uploads');
  const slots = Math.floor((Number(before.budget_bytes) - Number(before.stored_bytes)) / bytes);
  assert.ok(slots >= 2, 'backend needs room for two reservations');
  await checked(admin.from('reading_rooms').insert(Array.from({ length: slots - 1 }, () => f.room())));
  const rows = [f.room(), f.room()];
  const results = await Promise.all(rows.map(row => f.create(row, f.scope())));
  assert.deepEqual([...results].sort(), ['ok', 'storage_budget']);
  const full = await usage();
  assert.equal(Number(full.pending_bytes), slots * bytes);
  assert.equal(Number(full.budget_bytes), 20 * bytes);
  await checked(admin.from('reading_rooms').delete().eq('code', rows[results.indexOf('ok')].code));
  assert.equal(await f.create(f.room(), f.scope()), 'ok', 'deleting a reservation frees exactly one slot');
  assert.equal(Number((await usage()).pending_bytes), slots * bytes);
});

test('an uploaded object replaces its pending reservation with its actual byte size', async t => {
  const f = fixtures(t), row = f.room(), book = await epub();
  const before = await usage();
  await checked(admin.from('reading_rooms').insert(row));
  assert.equal(Number((await usage()).pending_bytes), Number(before.pending_bytes) + bytes);
  await checked(admin.storage.from('epubs').upload(row.book_path, book, { contentType: 'application/epub+zip' }));
  const after = await usage();
  assert.equal(Number(after.pending_bytes), Number(before.pending_bytes), 'uploaded bytes must not also reserve 25 MiB');
  assert.equal(Number(after.stored_bytes), Number(before.stored_bytes) + book.length);
});

test('maintenance requires its secret, removes stale unfinished objects, and preserves ready/recent rooms', async t => {
  assert.ok(process.env.CRON_SECRET, 'maintenance secret must be configured');
  const f = fixtures(t), old = new Date(Date.now() - 25 * 3600000).toISOString();
  const stale = f.room({ created_at: old }), ready = f.room({ created_at: old, ready: true }), recent = f.room();
  await checked(admin.from('reading_rooms').insert([stale, ready, recent]));
  const book = await epub();
  for (const row of [stale, ready, recent]) await checked(admin.storage.from('epubs').upload(row.book_path, book, { contentType: 'application/epub+zip' }));
  const oldScope = f.scope();
  await checked(admin.from('room_creation_limits').insert({ scope_hash: oldScope, window_kind: 'hour', window_start: new Date(Date.now() - 49 * 3600000).toISOString(), attempts: 1 }));
  for (const authorization of [undefined, 'Bearer incorrect']) {
    const response = await fetch(`${base}/api/cron/room-maintenance`, { headers: authorization ? { authorization } : {}, signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 401);
  }
  assert.equal((await checked(admin.from('reading_rooms').select('code').eq('code', stale.code))).length, 1, 'unauthorized maintenance cannot mutate data');
  const response = await fetch(`${base}/api/cron/room-maintenance`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200);
  const report = await response.json();
  assert.equal(report.removed, 1); assert.equal(report.failed, 0);
  const surviving = await checked(admin.from('reading_rooms').select('code').in('code', [stale.code, ready.code, recent.code]));
  assert.deepEqual(surviving.map(row => row.code).sort(), [ready.code, recent.code].sort());
  assert.ok((await admin.storage.from('epubs').download(stale.book_path)).error, 'stale EPUB must be removed from Storage');
  for (const row of [ready, recent]) assert.equal((await checked(admin.storage.from('epubs').download(row.book_path))).size, book.length);
  assert.deepEqual(await checked(admin.from('room_creation_limits').select('*').eq('scope_hash', oldScope)), []);
});
