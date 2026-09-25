import test from 'node:test';
import assert from 'node:assert/strict';
import { roomCreationScope } from '../src/lib/upload-guard.ts';

test('Vercel requests are grouped by trusted client address, not browser token', () => {
  const request = new Request('https://example.test/api/rooms', { headers: { 'x-vercel-forwarded-for': '203.0.113.12' } });
  assert.equal(roomCreationScope(request, 'guest-one', 'server-secret', true),
    roomCreationScope(request, 'guest-two', 'server-secret', true));
  assert.notEqual(roomCreationScope(request, 'guest-one', 'different-secret', true),
    roomCreationScope(request, 'guest-one', 'server-secret', true));
});

test('production fails closed without a valid platform address', () => {
  for (const value of ['', 'not-an-ip']) {
    const request = new Request('https://example.test/api/rooms', { headers: { 'x-vercel-forwarded-for': value } });
    assert.equal(roomCreationScope(request, 'guest', 'server-secret', true), null);
  }
});

test('local development uses its existing browser identity', () => {
  const request = new Request('http://localhost/api/rooms');
  assert.notEqual(roomCreationScope(request, 'guest-one', 'server-secret', false),
    roomCreationScope(request, 'guest-two', 'server-secret', false));
});
