import test from 'node:test';
import assert from 'node:assert/strict';
import { rememberRoom, savedRooms } from '../src/lib/room-history.ts';

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

test('blocked browser storage cannot prevent an admitted room from opening', () => {
  const storage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } };
  assert.deepEqual(savedRooms(storage), []);
  assert.doesNotThrow(() => rememberRoom(storage, room));
});
