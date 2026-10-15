import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { localBackend } from './local-backend.mjs';

const { url, base, local } = localBackend();
const token = () => randomBytes(32).toString('hex');
const hash = value => createHash('sha256').update(value).digest('hex');
test('room library checks membership without admission or device control and preserves personal archive through linking', { skip: !local, timeout: 90000 }, async () => {
  const db = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const guest = { device: token() }, stranger = { device: token() }, partner = { device: token() };
  const codes = [], users = [];
  async function request(who, path, method = 'GET', body) {
    const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${who.jwt || who.device}`, 'X-Reader-Token': who.device }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
  }
  async function row(extra = {}) {
    const code = randomBytes(6).toString('hex').toUpperCase(); codes.push(code);
    const result = await db.from('reading_rooms').insert({ code, title: 'Library book', book_path: `library-${randomUUID()}/book.epub`, topic: token(), reader_one: hash(guest.device), ready: true, ...extra });
    assert.equal(result.error, null); return code;
  }
  async function read(code) { const result = await db.from('reading_rooms').select('*').eq('code', code).single(); assert.equal(result.error, null); return result.data; }
  try {
    const position = { cfi: 'epubcfi(/6/2!/4/2/1:5)', section: 'Saved chapter', done: true };
    const code = await row({ position_one: position, reader_two: hash(partner.device), position_two: { ...position, section: 'Partner chapter' } });
    const before = await read(code);
    const listed = await request(guest, '/api/rooms/library', 'POST', { codes: [code] });
    assert.equal(listed.status, 200); assert.equal(listed.cache, 'no-store');
    assert.equal(listed.body.rooms[0].section, 'Saved chapter'); assert.equal(listed.body.rooms[0].linked, false);
    assert.deepEqual(Object.keys(listed.body.rooms[0]).sort(), ['archivedAt', 'code', 'createdAt', 'deleting', 'lastOpenedAt', 'linked', 'seat', 'section', 'title'].sort());
    assert.deepEqual(await read(code), before, 'listing must not change seats, controls, timestamps, positions or annotations');
    const denied = await request(stranger, '/api/rooms/library', 'POST', { codes: [code] });
    assert.deepEqual(denied.body, { rooms: [], unavailable: [code] });
    assert.equal((await request(stranger, `/api/rooms/${code}/archive`, 'PATCH', { archived: true })).status, 404);
    assert.equal((await request(guest, '/api/rooms/library', 'POST', { codes: Array(101).fill(code) })).status, 400);
    assert.equal((await request(guest, '/api/rooms/library?after=invalid')).status, 400);
    const archived = await request(guest, `/api/rooms/${code}/archive`, 'PATCH', { archived: true });
    assert.equal(archived.status, 200); assert.ok(archived.body.archivedAt);
    const afterArchive = await read(code);
    assert.equal(Date.parse(afterArchive.archived_at_one), Date.parse(archived.body.archivedAt));
    assert.equal(afterArchive.archived_at_two, null); assert.deepEqual(afterArchive.position_one, position);
    assert.deepEqual({ ...afterArchive, archived_at_one: null }, before, 'archive must change only the caller archive timestamp');
    assert.equal((await request(partner, '/api/rooms/library', 'POST', { codes: [code] })).body.rooms[0].archivedAt, null);

    const email = `library-${randomUUID()}@example.test`, password = token();
    const created = await db.auth.admin.createUser({ email, password, email_confirm: true }); assert.equal(created.error, null); users.push(created.data.user.id);
    const client = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const signed = await client.auth.signInWithPassword({ email, password }); assert.equal(signed.error, null);
    const profile = { device: guest.device, jwt: signed.data.session.access_token };
    const signInOnly = await request(profile, '/api/rooms/library');
    assert.deepEqual(signInOnly.body.rooms, [], 'signing in must not link a guest seat');
    const linked = await request(profile, '/api/profile/link', 'POST', { rooms: [{ code, position }] });
    assert.deepEqual(linked.body.linked, [code]);
    const afterLink = await read(code);
    assert.equal(Date.parse(afterLink.archived_at_one), Date.parse(archived.body.archivedAt)); assert.deepEqual(afterLink.position_one, position);

    // More than the former 50-room cutoff, including both seat positions.
    for (let i = 0; i < 53; i++) await row(i % 2 ? { reader_one: token(), reader_two: hash(`user:${users[0]}`), reader_two_user: users[0] } : { reader_one: hash(`user:${users[0]}`), reader_one_user: users[0] });
    const remote = { ...profile, device: token() };
    const firstPage = await request(remote, '/api/rooms/library');
    assert.equal(firstPage.body.rooms.length, 50); assert.equal(firstPage.body.nextCursor, firstPage.body.rooms.at(-1).code);
    // Removing an earlier row between pages must not skip an unseen room.
    const removedCode = firstPage.body.rooms.find(item => item.code !== code).code;
    assert.equal((await db.from('reading_rooms').delete().eq('code', removedCode)).error, null);
    const secondPage = await request(remote, `/api/rooms/library?after=${firstPage.body.nextCursor}`);
    assert.equal(secondPage.body.rooms.length, 4); assert.equal(secondPage.body.nextCursor, null);
    const all = [...firstPage.body.rooms, ...secondPage.body.rooms];
    assert.equal(new Set(all.map(item => item.code)).size, 54);
    assert.equal(Date.parse(all.find(item => item.code === code).archivedAt), Date.parse(archived.body.archivedAt));
    assert.deepEqual(await read(code), afterLink, 'listing from a second device must not take control or mutate progress');
    const restored = await request(remote, `/api/rooms/${code}/archive`, 'PATCH', { archived: false });
    assert.equal(restored.status, 200); assert.equal(restored.body.archivedAt, null);
    const afterRestore = await read(code);
    assert.equal(afterRestore.control_hash_one, afterLink.control_hash_one);
    assert.equal(afterRestore.control_version_one, afterLink.control_version_one);
    assert.deepEqual(afterRestore.position_one, position);
    assert.equal((await request(guest, '/api/rooms/library', 'POST', { codes: [code] })).body.rooms.length, 0, 'old guest identity cannot list a linked seat');
    const direct = await client.from('reading_rooms').select('code,archived_at_one,last_opened_at_one');
    assert.ok(direct.error || direct.data?.length === 0, 'browser table access remains denied');
  } finally {
    if (codes.length) { const removed = await db.from('reading_rooms').delete().in('code', codes); assert.equal(removed.error, null); }
    for (const id of users) await db.auth.admin.deleteUser(id);
  }
});
