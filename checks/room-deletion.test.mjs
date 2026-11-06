import test from 'node:test';
import assert from 'node:assert/strict';
import { completeRoomDeletion } from '../src/lib/room-deletion.ts';
import { forgetDeletedRoom } from '../src/lib/forget-room.ts';

test('storage failure keeps the deletion record; database failure safely retries missing storage', async () => {
  let book = true, room = true, storageFailure = true, databaseFailure = true;
  const operations = {
    removeBook: async () => { if (storageFailure) throw Error('storage unavailable'); book = false; },
    removeRoom: async () => { if (databaseFailure) throw Error('database unavailable'); room = false; },
  };
  await assert.rejects(completeRoomDeletion(operations), /storage unavailable/);
  assert.equal(book, true); assert.equal(room, true);
  storageFailure = false;
  await assert.rejects(completeRoomDeletion(operations), /database unavailable/);
  assert.equal(book, false); assert.equal(room, true);
  databaseFailure = false;
  await Promise.all([completeRoomDeletion(operations), completeRoomDeletion(operations)]);
  assert.equal(book, false); assert.equal(room, false);
});

test('confirmed deletion cleans only this room and preserves other rooms and global settings', () => {
  const code = '123456789ABC', other = 'ABCDEF123456';
  const values = new Map([
    ['read-together:rooms', JSON.stringify([{ code, seat: 1 }, { code: other, seat: 2 }])],
    ['read-together:room', code], ['read-together:demo', code],
    [`read-together:${code}:1`, 'position'], [`read-together:${code}:1:pending`, 'pending'],
    [`read-together:${code}:2:partner`, 'partner'], [`read-together:${other}:2:pending`, 'other pending'],
    ['read-together:token', 'credential'], ['read-together:reading-settings:v1', 'sepia'],
  ]);
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  assert.equal(forgetDeletedRoom(storage, code), true);
  assert.deepEqual(JSON.parse(values.get('read-together:rooms')), [{ code: other, seat: 2 }]);
  assert.equal(values.get(`read-together:${code}:1:pending`), undefined);
  assert.equal(values.get('read-together:demo'), undefined);
  assert.equal(values.get(`read-together:${other}:2:pending`), 'other pending');
  assert.equal(values.get('read-together:token'), 'credential');
  assert.equal(values.get('read-together:reading-settings:v1'), 'sepia');
  assert.equal(forgetDeletedRoom({ ...storage, removeItem: () => { throw Error('blocked'); } }, code), false);
});
