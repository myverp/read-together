import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { isolatedBackend } from './local-backend.mjs';
import { epub } from '../tests/epub.ts';

const { url, base } = isolatedBackend();
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const publicClient = () => createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const token = () => randomBytes(32).toString('hex');
const hash = value => createHash('sha256').update(value).digest('hex');
const confirmed = { confirmation: 'ВИДАЛИТИ' };
const position = { cfi: 'epubcfi(/6/2!/4/2/1:5)', section: 'Saved section', done: true };
async function checked(promise) { const result = await promise; assert.equal(result.error, null, JSON.stringify(result.error)); return result.data; }
async function request(who, code, method = 'DELETE', body = confirmed, suffix = '') {
  const response = await fetch(`${base}/api/rooms/${code}${suffix}`, { method,
    headers: { authorization: `Bearer ${who.jwt || who.device}`, 'x-reader-token': who.device, 'content-type': 'application/json' },
    body: method === 'GET' || body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  return { status: response.status, body: await response.json() };
}
async function fixture(t) {
  const creator = { device: token() }, partner = { device: token() };
  const room = { code: randomBytes(6).toString('hex').toUpperCase(), title: 'Deletion fixture', book_path: `${token()}/book.epub`, topic: token(),
    reader_one: hash(creator.device), reader_two: hash(partner.device), ready: true, position_one: position, position_two: position };
  await checked(admin.from('reading_rooms').insert(room));
  await checked(admin.storage.from('epubs').upload(room.book_path, await epub(), { contentType: 'application/epub+zip' }));
  t.after(async () => {
    await checked(admin.storage.from('epubs').remove([room.book_path]));
    await checked(admin.from('reading_rooms').delete().eq('code', room.code));
    await checked(admin.from('room_creation_events').delete().eq('code', room.code));
  });
  return { creator, partner, room };
}
function sql(text) {
  // Fault injection only in the explicitly checked disposable CI container.
  const result = spawnSync('docker', ['exec', '-i', 'supabase_db_read-together-ci', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: text, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

test('creator-only deletion requires confirmation; partner data remains unchanged on denial', async t => {
  const { creator, partner, room } = await fixture(t);
  for (const who of [partner, { device: token() }]) assert.equal((await request(who, room.code)).status, 403);
  assert.equal((await request(creator, room.code, 'DELETE', { confirmation: 'delete' })).status, 400);
  const before = await checked(admin.from('reading_rooms').select('*').eq('code', room.code).single());
  assert.equal(before.deletion_requested_at, null); assert.deepEqual(before.position_two, position);
  assert.ok(await checked(admin.storage.from('epubs').download(room.book_path)));
  const args = { p_code: room.code, p_user: null, p_guest_hash: hash(creator.device), p_control_hash: hash(creator.device) };
  assert.ok((await publicClient().rpc('request_room_deletion', args)).error, 'anonymous callers cannot forge RPC identity');
  assert.ok((await publicClient().from('room_creation_events').select('*')).error, 'creation ledger is private');
  const results = await Promise.all([request(creator, room.code), request(creator, room.code)]);
  assert.deepEqual(results.map(result => result.status), [200, 200]);
  assert.deepEqual(await checked(admin.from('reading_rooms').select('code').eq('code', room.code)), []);
  assert.ok((await admin.storage.from('epubs').download(room.book_path)).error);
  assert.equal((await request(creator, room.code)).status, 200, 'lost successful response can be retried');
  assert.equal((await request(partner, room.code, 'GET', undefined, '/state')).body.code, 'room_unavailable');
});

test('profile deletion requires the active creator device, not a linked guest token or partner', async t => {
  const { creator, partner, room } = await fixture(t);
  const email = `delete-${randomUUID()}@example.test`, password = token();
  const user = await checked(admin.auth.admin.createUser({ email, password, email_confirm: true }));
  // Registered before fixture cleanup: run explicitly after deleting the linked room.
  t.after(async () => { await checked(admin.from('reading_rooms').delete().eq('code', room.code)); await checked(admin.auth.admin.deleteUser(user.user.id)); });
  const client = publicClient();
  const session = await checked(client.auth.signInWithPassword({ email, password }));
  await checked(admin.from('profiles').insert({ user_id: user.user.id, name: 'Creator' }));
  await checked(admin.from('reading_rooms').update({ reader_one_user: user.user.id, control_hash_one: hash(creator.device), control_version_one: 1 }).eq('code', room.code));
  const profile = { ...creator, jwt: session.session.access_token };
  assert.ok((await client.rpc('request_room_deletion', { p_code: room.code, p_user: user.user.id, p_guest_hash: hash(creator.device), p_control_hash: hash(creator.device) })).error);
  assert.equal((await request(creator, room.code)).status, 403, 'old browser bearer loses ownership after profile linking');
  assert.equal((await request({ ...profile, device: token() }, room.code)).status, 409);
  assert.equal((await request(partner, room.code)).status, 403);
  await checked(admin.rpc('request_room_deletion', { p_code: room.code, p_user: user.user.id, p_guest_hash: hash(creator.device), p_control_hash: hash(creator.device) }));
  const otherDevice = await request({ ...profile, device: token() }, room.code);
  assert.equal(otherDevice.status, 409); assert.match(otherDevice.body.error, /Cleanup will finish automatically/);
  assert.equal((await request(profile, room.code)).status, 200);
});

test('deletion mark serializes concurrent writes and blocks every room endpoint before cleanup', async t => {
  const { creator, partner, room } = await fixture(t);
  const mark = () => admin.rpc('request_room_deletion', { p_code: room.code, p_user: null, p_guest_hash: hash(creator.device), p_control_hash: hash(creator.device) });
  const [marked, raced] = await Promise.all([mark(), admin.from('reading_rooms').update({ position_two: { ...position, done: false } }).eq('code', room.code)]);
  assert.equal(marked.error, null); assert.equal(marked.data.code, 'deleting');
  assert.ok(raced.error === null || raced.error.code === 'PT410', 'write either commits before mark or is rejected');
  const before = await checked(admin.from('reading_rooms').select('*').eq('code', room.code).single());
  for (const patch of [{ position_two: position }, { reader_two: token() }, { highlight_state: { revision: 9, items: [], colors: [1, 2] } }, { drawing_state: { revision: 9, items: [] } }, { deletion_requested_at: null }])
    assert.equal((await admin.from('reading_rooms').update(patch).eq('code', room.code)).error?.code, 'PT410');
  const saved = await admin.rpc('save_reading_progress', { p_code: room.code, p_seat: 2, p_user: null, p_guest_hash: hash(partner.device), p_control_hash: hash(partner.device), p_control_version: null, p_revision: null, p_position: position });
  assert.equal(saved.error?.code, 'PT410');
  for (const who of [creator, partner]) {
    const response = await fetch(`${base}/api/rooms/library`, { method: 'POST', headers: { authorization: `Bearer ${who.device}`, 'content-type': 'application/json' }, body: JSON.stringify({ codes: [room.code] }) });
    const listed = await response.json();
    assert.equal(response.status, 200);
    if (who === creator) assert.equal(listed.rooms[0].deleting, true);
    else assert.deepEqual(listed, { rooms: [], unavailable: [room.code] });
  }
  const calls = [
    [creator, 'POST', undefined, ''], [partner, 'GET', undefined, '/state'],
    [partner, 'PATCH', { position }, '/state'], [partner, 'GET', undefined, '/highlights'],
    [partner, 'GET', undefined, '/drawings'], [partner, 'PATCH', { color: 5 }, '/color'],
    [partner, 'POST', { action: 'voices' }, '/speech'], [creator, 'PATCH', { archived: true }, '/archive'],
  ];
  for (const [who, method, body, suffix] of calls) {
    const result = await request(who, room.code, method, body, suffix);
    assert.equal(result.status, 410, `${method} ${suffix}: ${JSON.stringify(result.body)}`);
  }
  const after = await checked(admin.from('reading_rooms').select('*').eq('code', room.code).single());
  assert.deepEqual(after, before);
  assert.equal((await request(creator, room.code)).status, 200);
});

test('failed database cleanup preserves retry state after Storage removal; maintenance finishes it', async t => {
  const { creator, room } = await fixture(t);
  sql(`create function public.ci_block_room_delete() returns trigger language plpgsql as $$ begin
    if old.code = '${room.code}' then raise exception 'CI injected cleanup failure'; end if; return old; end $$;
    create trigger ci_block_room_delete before delete on public.reading_rooms for each row execute function public.ci_block_room_delete();`);
  try {
    assert.equal((await request(creator, room.code)).status, 503);
    assert.ok((await checked(admin.from('reading_rooms').select('deletion_requested_at').eq('code', room.code).single())).deletion_requested_at);
    assert.ok((await admin.storage.from('epubs').download(room.book_path)).error, 'file removed before failed DB deletion');
  } finally { sql('drop trigger ci_block_room_delete on public.reading_rooms; drop function public.ci_block_room_delete();'); }
  const response = await fetch(`${base}/api/cron/room-maintenance`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
  assert.equal(response.status, 200); assert.ok((await response.json()).deleted >= 1);
  assert.equal((await request(creator, room.code)).status, 200);
});

test('deleting rooms releases bytes without resetting browser or network creation limits', async t => {
  const { creator, room } = await fixture(t);
  const scope = token();
  const codes = [];
  t.after(async () => {
    await checked(admin.from('reading_rooms').delete().in('code', codes));
    await checked(admin.from('room_creation_events').delete().in('code', codes));
    await checked(admin.from('room_creation_limits').delete().eq('scope_hash', scope));
  });
  const create = async () => {
    const code = randomBytes(6).toString('hex').toUpperCase(); codes.push(code);
    return checked(admin.rpc('create_reading_room', { p_code: code, p_title: 'Limit fixture', p_book_path: `${token()}/book.epub`, p_topic: token(),
      p_reader_one: hash(creator.device), p_reader_one_user: null, p_control_hash_one: null, p_preferred_color: -1, p_scope_hash: scope }));
  };
  for (let i = 0; i < 9; i++) { assert.equal(await create(), 'ok'); await checked(admin.from('reading_rooms').delete().eq('code', codes.at(-1))); }
  const before = await checked(admin.rpc('room_storage_usage').single());
  assert.equal((await request(creator, room.code)).status, 200);
  const after = await checked(admin.rpc('room_storage_usage').single());
  assert.ok(Number(after.stored_bytes) < Number(before.stored_bytes));
  assert.equal(await create(), 'browser_limit');
  const counters = await checked(admin.from('room_creation_limits').select('attempts').eq('scope_hash', scope));
  assert.deepEqual(counters.map(row => row.attempts), [9, 9]);
});
