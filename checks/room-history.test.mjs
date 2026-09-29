import test from 'node:test';
import assert from 'node:assert/strict';
import { lastRoom, rememberRoom, savedRooms } from '../src/lib/room-history.ts';

const room = { code: 'A1B2C3D4E5F6', seat: 1 };

test('corrupt and invalid room history does not prevent remembering a room', () => {
  for (const initial of ['{broken', '{}', '[null,{"code":"BAD","seat":3}]']) {
    const values = new Map([['read-together:rooms', initial]]);
    const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
    assert.deepEqual(savedRooms(storage), []);
    rememberRoom(storage, room);
    assert.deepEqual(savedRooms(storage), [room]);
    assert.equal(values.get('read-together:room'), room.code);
  }
});

test('legacy history resumes and persisted rooms never include capabilities', () => {
  const values = new Map([['read-together:rooms', JSON.stringify([room])]]);
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  assert.deepEqual(lastRoom(storage), room);
  rememberRoom(storage, { ...room, title: 'A book', topic: 'private-topic', bookUrl: 'https://signed.example/secret', profile: { email: 'private@example.test' } });
  assert.deepEqual(savedRooms(storage), [{ ...room, title: 'A book' }]);
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
