import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { epub } from '../tests/epub.ts';

// Explicitly local: this test creates and removes its own accounts, EPUB, and room.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const base = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3101';
const local = url && ['localhost', '127.0.0.1'].includes(new URL(url).hostname)
  && ['localhost', '127.0.0.1'].includes(new URL(base).hostname);
const token = () => randomBytes(32).toString('hex');

test('real local profiles preserve seats, deny stale devices, and serialize room colors', { skip: !local, timeout: 90000 }, async () => {
  const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const publicClient = () => createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const users = [];
  let roomCode, bookPath;
  async function account() {
    const email = `security-${randomUUID()}@example.test`, password = token();
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.equal(created.error, null); users.push(created.data.user.id);
    const client = publicClient();
    const signed = await client.auth.signInWithPassword({ email, password });
    assert.equal(signed.error, null);
    return { jwt: signed.data.session.access_token, device: token(), client };
  }
  async function request(who, path, method = 'GET', body) {
    const response = await fetch(`${base}${path}`, { method, headers: {
      'Content-Type': 'application/json', Authorization: `Bearer ${who.jwt || who.device}`, 'X-Reader-Token': who.device,
    }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  try {
    const guest = { device: token() };
    const book = await epub();
    const upload = await request(guest, '/api/rooms', 'POST', { name: 'Profile security.epub', size: book.length });
    assert.equal(upload.status, 200, JSON.stringify(upload.body));
    roomCode = upload.body.code; bookPath = upload.body.path;
    const uploaded = await publicClient().storage.from('epubs').uploadToSignedUrl(bookPath, upload.body.uploadToken, book, { contentType: 'application/epub+zip' });
    assert.equal(uploaded.error, null);
    const roomPath = `/api/rooms/${roomCode}`;
    const opened = await request(guest, roomPath, 'POST');
    assert.equal(opened.status, 200, JSON.stringify(opened.body));
    const mark = { id: randomUUID(), cfi: 'epubcfi(/6/2!/4/2,/1:0,/1:5)', quote: 'Hello', comment: 'Keep this comment' };
    assert.equal((await request(guest, `${roomPath}/highlights`, 'POST', mark)).status, 200);

    const first = await account(); first.device = guest.device;
    const second = await account(), third = await account();
    assert.equal((await request(first, '/api/profile')).status, 200);
    const preferred = await request(first, '/api/profile', 'PATCH', { name: 'First reader', avatar: 'leaf', preferredColor: 4 });
    assert.equal(preferred.status, 200);
    const position = { cfi: 'epubcfi(/6/2!/4/2/1:5)', section: 'Saved passage', done: true };
    const linked = await request(first, '/api/profile/link', 'POST', { rooms: [{ code: roomCode, position }] });
    assert.equal(linked.status, 200, JSON.stringify(linked.body));
    assert.deepEqual(linked.body.linked, [roomCode]);
    assert.equal((await request(guest, `${roomPath}/highlights`)).status, 403, 'old guest credential must lose access');
    const firstRoom = await request(first, roomPath, 'POST');
    assert.equal(firstRoom.status, 200);
    assert.equal(firstRoom.body.seat, 1);
    assert.deepEqual(firstRoom.body.me, position, 'guest progress and Done must migrate');
    const listed = await request(first, '/api/profile');
    assert.ok(listed.body.rooms.some(room => room.code === roomCode));

    const partner = await request(second, roomPath, 'POST');
    assert.equal(partner.status, 200); assert.equal(partner.body.seat, 2);
    assert.equal((await request(third, roomPath, 'POST')).status, 409, 'no third person');
    const stolen = await request(third, '/api/profile/link', 'POST', { rooms: [{ code: roomCode, position }] });
    assert.deepEqual(stolen.body.linked, [], 'knowing a room code cannot claim someone else’s seat');

    const otherDevice = { ...first, device: token() };
    assert.equal((await request(otherDevice, roomPath, 'POST')).body.takeoverRequired, true);
    const takeover = await request(otherDevice, roomPath, 'POST', { takeover: true });
    assert.equal(takeover.status, 200); assert.equal(takeover.body.seat, 1);
    assert.deepEqual(takeover.body.me, position);
    assert.equal((await request(first, `${roomPath}/state`)).body.active, false);
    const stale = await request(first, `${roomPath}/state`, 'PATCH', { position: { ...position, done: false }, controlVersion: firstRoom.body.controlVersion });
    assert.equal(stale.status, 409); assert.equal(stale.body.takenOver, true);
    assert.equal((await request(first, `${roomPath}/color`, 'PATCH', { color: 8 })).status, 409);
    assert.equal((await request(first, `${roomPath}/highlights`, 'POST', { ...mark, id: randomUUID() })).status, 409);
    const currentPosition = { ...position, section: 'New device position', done: false };
    assert.equal((await request(otherDevice, `${roomPath}/state`, 'PATCH', { position: currentPosition, controlVersion: takeover.body.controlVersion })).status, 200);
    assert.deepEqual((await request(otherDevice, `${roomPath}/state`)).body.me, currentPosition);

    const color = [0,1,2,3,4,5,6,7,8,9].find(value => value !== firstRoom.body.color && value !== partner.body.color);
    const raced = await Promise.all([otherDevice, second].map(who => request(who, `${roomPath}/color`, 'PATCH', { color })));
    assert.deepEqual(raced.map(r => r.status).sort(), [200,409], 'only one reader may reserve the same color');
    const colors = (await admin.from('reading_rooms').select('highlight_state').eq('code', roomCode).single()).data.highlight_state.colors;
    assert.notEqual(colors[0], colors[1]);
    const marks = await request(otherDevice, `${roomPath}/highlights`);
    assert.equal(marks.body.items[0].color, colors[0], 'existing marks are recolored');
    assert.equal(marks.body.items[0].comment, mark.comment);
    assert.equal((await request(second, `${roomPath}/highlights`, 'DELETE', { id: mark.id })).status, 403);

    const privateBook = await fetch(takeover.body.bookUrl); assert.equal(privateBook.status, 200);
    const unsigned = new URL(takeover.body.bookUrl); unsigned.search = '';
    assert.notEqual((await fetch(unsigned)).status, 200);
    for (const client of [publicClient(), first.client]) {
      for (const table of ['profiles', 'reading_rooms']) {
        const direct = await client.from(table).select('*').limit(1);
        assert.ok(direct.error, `${table} must not be accessible directly by browser roles`);
      }
    }
  } finally {
    if (bookPath) await admin.storage.from('epubs').remove([bookPath]);
    if (roomCode) await admin.from('reading_rooms').delete().eq('code', roomCode);
    for (const id of users) await admin.auth.admin.deleteUser(id);
  }
});
