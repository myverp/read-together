import test from 'node:test';
import assert from 'node:assert/strict';
import { cacheRoomMetadata, lastRoom, rememberRoom, savedRooms } from '../src/lib/room-history.ts';

const room = { code: 'A1B2C3D4E5F6', seat: 1 };

test('corrupt and invalid room history does not prevent remembering a room', () => {
  for (const initial of ['{broken', '{}', '[null,{"code":"BAD","seat":3}]']) {
    const values = new Map([['read-together:rooms', initial]]);
    const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
    assert.deepEqual(savedRooms(storage), []);
    rememberRoom(storage, room);
    assert.deepEqual(savedRooms(storage).map(({ lastOpenedAt, ...entry }) => entry), [room]);
    assert.equal(values.get('read-together:room'), room.code);
  }
});

test('legacy history resumes and persisted rooms never include capabilities', () => {
  const values = new Map([['read-together:rooms', JSON.stringify([room])]]);
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  assert.deepEqual(lastRoom(storage), room);
  rememberRoom(storage, { ...room, title: 'A book', topic: 'private-topic', bookUrl: 'https://signed.example/secret', profile: { email: 'private@example.test' } });
  assert.deepEqual(savedRooms(storage).map(({ lastOpenedAt, ...entry }) => entry), [{ ...room, title: 'A book' }]);
  const serialized = values.get('read-together:rooms');
  assert.doesNotMatch(serialized, /private|signed|secret/);
  values.set('read-together:rooms', '[{"code":123456789012,"seat":1}]');
  values.delete('read-together:room'); assert.equal(lastRoom(storage), null);
});

test('blocked browser storage cannot prevent an admitted room from opening', () => {
  const storage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } };
  assert.deepEqual(savedRooms(storage), []);
  assert.doesNotThrow(() => rememberRoom(storage, room));
});

test('room history retains more than fifty entries and safe metadata without touching pending progress', () => {
  const entries = Array.from({ length: 120 }, (_, index) => ({ code: index.toString(16).toUpperCase().padStart(12, '0'), seat: 1, title: `Book ${index}` }));
  const values = new Map([['read-together:rooms', JSON.stringify(entries)], ['read-together:000000000000:1:pending', 'untouched']]);
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const archivedAt = '2026-10-15T12:00:00.000Z';
  cacheRoomMetadata(storage, [{ ...entries[0], archivedAt, section: 'Chapter two', topic: 'private-topic', bookUrl: 'signed-secret' }]);
  rememberRoom(storage, entries[0]);
  assert.equal(savedRooms(storage).length, 120);
  assert.equal(savedRooms(storage)[0].archivedAt, archivedAt, 'opening an archived room must not restore it');
  assert.equal(savedRooms(storage)[0].section, 'Chapter two');
  assert.notEqual(lastRoom(storage)?.code, entries[0].code, 'continue ignores archived rooms');
  assert.equal(values.get('read-together:000000000000:1:pending'), 'untouched');
  assert.doesNotMatch(values.get('read-together:rooms'), /private|signed|secret/);
  cacheRoomMetadata(storage, [{ ...entries[0], archivedAt: null }]);
  assert.equal(savedRooms(storage)[0].archivedAt, null);
});
