import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { isolatedBackend } from './local-backend.mjs';
const { url, base } = isolatedBackend();
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const token = () => randomBytes(32).toString('hex');
const hash = value => createHash('sha256').update(value).digest('hex');
async function checked(promise) { const r = await promise; assert.equal(r.error, null, JSON.stringify(r.error)); return r.data; }
test('comment edits preserve authorship, serialize conflicts, retry safely and reject stale devices/deleted rooms', async t => {
  const one = token(), two = token(), code = randomBytes(6).toString('hex').toUpperCase();
  const original = { id: randomUUID(), cfi: 'epubcfi(/6/2!/4/2,/1:0,/1:5)', quote: 'Original quote', comment: 'Original comment', seat: 1, color: 0 };
  const partner = { ...original, id: randomUUID(), seat: 2, color: 1, comment: 'Partner comment' };
  await checked(admin.from('reading_rooms').insert({ code, title: 'Notes security', book_path: `${token()}/book.epub`, topic: token(), ready: true,
    reader_one: hash(one), reader_two: hash(two), highlight_state: { revision: 1, items: [original, partner], colors: [0, 1] } }));
  let userId;
  t.after(async () => { await checked(admin.from('reading_rooms').delete().eq('code', code)); await checked(admin.from('room_creation_events').delete().eq('code', code)); if (userId) await checked(admin.auth.admin.deleteUser(userId)); });
  const request = async (device, body, method = 'PATCH', jwt) => {
    const r = await fetch(`${base}/api/rooms/${code}/highlights`, { method, headers: { authorization: `Bearer ${jwt || device}`, 'x-reader-token': device, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  const edit = { id: original.id, previousComment: original.comment, comment: 'Edited' };
  assert.equal((await request(two, edit)).status, 403);
  assert.equal((await request(token(), edit)).status, 403);
  assert.equal((await request(one, { ...edit, comment: 'x'.repeat(1001) })).status, 400);
  const edits = await Promise.all([request(one, edit), request(one, { ...edit, comment: 'Concurrent' })]);
  assert.deepEqual(edits.map(r => r.status).sort(), [200, 409]);
  const winner = edits.find(r => r.status === 200).body;
  const saved = winner.items.find(n => n.id === original.id);
  assert.deepEqual({ ...saved, comment: original.comment }, original);
  assert.deepEqual(winner.items.find(n => n.id === partner.id), partner);
  const retry = await request(one, { ...edit, comment: saved.comment });
  assert.equal(retry.status, 200); assert.equal(retry.body.revision, winner.revision);
  const independent = await Promise.all([
    request(one, { ...edit, previousComment: saved.comment, comment: 'Next comment' }),
    request(two, { id: partner.id, previousComment: partner.comment, comment: 'Partner changed' }),
  ]);
  assert.deepEqual(independent.map(r => r.status), [200, 200]);
  const password = token(), email = `notes-${randomUUID()}@example.test`;
  const user = await checked(admin.auth.admin.createUser({ email, password, email_confirm: true })); userId = user.user.id;
  await checked(admin.from('profiles').insert({ user_id: userId, name: 'Notes owner' }));
  const client = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const session = await checked(client.auth.signInWithPassword({ email, password }));
  await checked(admin.from('reading_rooms').update({ reader_one_user: userId, control_hash_one: hash(one), control_version_one: 1 }).eq('code', code));
  const linkedEdit = { ...edit, previousComment: 'Next comment', comment: 'Linked edit' };
  assert.equal((await request(one, linkedEdit)).status, 403);
  assert.equal((await request(token(), linkedEdit, 'PATCH', session.session.access_token)).status, 409);
  assert.equal((await request(one, linkedEdit, 'PATCH', session.session.access_token)).status, 200);
  assert.equal((await request(one, { id: original.id }, 'DELETE', session.session.access_token)).status, 200);
  assert.equal((await request(one, linkedEdit, 'PATCH', session.session.access_token)).status, 404);
  await checked(admin.from('reading_rooms').update({ deletion_requested_at: new Date().toISOString() }).eq('code', code));
  assert.equal((await request(two, { id: partner.id, previousComment: 'Partner changed', comment: 'Too late' })).status, 410);
});
