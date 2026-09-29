import test from 'node:test';
import assert from 'node:assert/strict';
import { invitationCode } from '../src/lib/room-invitation.ts';

test('invitation accepts only a complete room code or this origin’s room URL', () => {
  const origin = 'https://reader.example';
  for (const input of [' a1b2 c3d4 e5f6 ', `${origin}/room/a1b2c3d4e5f6`]) {
    assert.equal(invitationCode(input, origin), 'A1B2C3D4E5F6');
  }
  for (const input of ['BAD', 'A1B2C3D4E5F67', 'https://evil.example/room/A1B2C3D4E5F6', `${origin}/room/A1B2C3D4E5F6/extra`, `${origin}/room/A1B2C3D4E5F6?token=secret`, `${origin}/room/A1B2C3D4E5F6#secret`, 'javascript:alert(1)', 'https://reader.example@evil.example/room/A1B2C3D4E5F6', `${origin}/elsewhere/A1B2C3D4E5F6`]) {
    assert.equal(invitationCode(input, origin), null, input);
  }
});
