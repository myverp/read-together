import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { epub } from '../tests/epub.ts';

// This integration check is intentionally restricted to the local test backend.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const base = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
const local = url && ['localhost', '127.0.0.1'].includes(new URL(url).hostname)
  && ['localhost', '127.0.0.1'].includes(new URL(base).hostname);
const token = () => randomBytes(32).toString('hex');
const drawing = () => ({
  id: randomUUID(), cfi: 'epubcfi(/6/2!/4/2,/1:0,/1:5)', anchor: [80, 60],
  page: { width: 390, height: 500, runs: [{ text: 'Hello', x: 50, y: 50, width: 60, height: 24, family: 'Georgia', size: 18, weight: '400', style: 'normal', color: '#111111' }] },
  strokes: [{ width: 3, points: [[60, 60], [120, 90], [160, 50]] }],
});

test('local drawing API preserves ownership, retries, concurrency and device control', { skip: !local, timeout: 90000 }, async () => {
  const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const client = () => createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const users = [];
  let roomCode, bookPath;
  async function account() {
    const email = `drawing-${randomUUID()}@example.test`, password = token();
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.equal(created.error, null); users.push(created.data.user.id);
    const auth = client();
    const signed = await auth.auth.signInWithPassword({ email, password });
    assert.equal(signed.error, null);
    return { jwt: signed.data.session.access_token, device: token(), auth };
  }
  async function request(who, path, method = 'GET', body) {
    const response = await fetch(`${base}${path}`, { method, headers: {
      'Content-Type': 'application/json', Authorization: `Bearer ${who.jwt || who.device}`, 'X-Reader-Token': who.device,
    }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  try {
    const first = await account(), second = await account(), outsider = { device: token() };
    const book = await epub();
    const upload = await request(first, '/api/rooms', 'POST', { name: 'Drawing security.epub', size: book.length });
    assert.equal(upload.status, 200, JSON.stringify(upload.body));
    roomCode = upload.body.code; bookPath = upload.body.path;
    const uploaded = await client().storage.from('epubs').uploadToSignedUrl(bookPath, upload.body.uploadToken, book, { contentType: 'application/epub+zip' });
    assert.equal(uploaded.error, null);
    const room = `/api/rooms/${roomCode}`, path = `${room}/drawings`;
    assert.equal((await request(first, room, 'POST')).status, 200);
    assert.equal((await request(second, room, 'POST')).status, 200);
    assert.equal((await request(outsider, room, 'POST')).status, 409);
    for (const method of ['GET', 'POST', 'DELETE']) {
      assert.equal((await request(outsider, path, method, method === 'GET' ? undefined : drawing())).status, 403);
    }
    const original = drawing();
    const saved = await request(first, path, 'POST', { ...original, seat: 2, color: '#ff0000', ignored: 'not stored' });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.items[0].seat, 1);
    assert.equal(saved.body.items[0].ignored, undefined);
    const again = await request(first, path, 'POST', original);
    assert.equal(again.body.revision, saved.body.revision, 'a retried id cannot create a second drawing');
    assert.equal(again.body.items.length, 1);
    assert.deepEqual((await request(second, path)).body.items[0].strokes, original.strokes);
    assert.equal((await request(second, path, 'DELETE', { id: original.id })).status, 403);

    for (const invalid of [
      { ...drawing(), strokes: [] }, { ...drawing(), strokes: [null] },
      { ...drawing(), strokes: [{ width: 2, points: [[-1, 0]] }] },
      { ...drawing(), page: { ...original.page, runs: [null] } },
      { ...drawing(), page: { ...original.page, width: 50000 } },
    ]) assert.equal((await request(first, path, 'POST', invalid)).status, 400, 'invalid payload must be a client error');
    assert.equal((await request(first, path, 'POST', { ...drawing(), extra: 'a'.repeat(190000) })).status, 413);

    const parallel = await Promise.all([first, second].map(who => request(who, path, 'POST', drawing())));
    assert.deepEqual(parallel.map(result => result.status), [200, 200]);
    const both = await request(first, path);
    assert.equal(both.body.items.length, 3, 'concurrent writers cannot overwrite each other');

    const nextDevice = { ...first, device: token() };
    assert.equal((await request(nextDevice, room, 'POST', { takeover: true })).status, 200);
    assert.equal((await request(first, path)).status, 200, 'previous device remains view-only');
    for (const method of ['POST', 'DELETE']) {
      const result = await request(first, path, method, method === 'POST' ? drawing() : { id: original.id });
      assert.equal(result.status, 409); assert.equal(result.body.takenOver, true);
    }
    assert.equal((await request(nextDevice, path, 'DELETE', { id: original.id })).status, 200);
    assert.equal((await request(second, path)).body.items.some(item => item.id === original.id), false);
    for (const auth of [client(), second.auth]) {
      const direct = await auth.from('reading_rooms').select('drawing_state').eq('code', roomCode);
      assert.ok(direct.error, 'browser roles cannot directly read drawing data');
    }
  } finally {
    if (bookPath) await admin.storage.from('epubs').remove([bookPath]);
    if (roomCode) await admin.from('reading_rooms').delete().eq('code', roomCode);
    for (const id of users) await admin.auth.admin.deleteUser(id);
  }
});
