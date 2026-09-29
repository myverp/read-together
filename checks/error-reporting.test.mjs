import test from 'node:test';
import assert from 'node:assert/strict';
import * as Sentry from '@sentry/node';
import { safeErrorEvent, reportServerError, drainErrorReports } from '../src/lib/error-reporting.ts';
test('preview builds remain separate from production and unknown environment values are discarded', () => {
  const previous = { VERCEL_ENV: process.env.VERCEL_ENV, NODE_ENV: process.env.NODE_ENV };
  const event = { type: undefined, tags: { source: 'read-together-server', operation: 'save-progress', route: '/api/rooms/[code]/state', status: '503' } };
  try {
    process.env.NODE_ENV = 'production';
    for (const environment of ['preview', 'production', 'development']) {
      process.env.VERCEL_ENV = environment;
      assert.equal(safeErrorEvent(event).environment, environment);
    }
    process.env.VERCEL_ENV = 'PRIVATE_UNEXPECTED_VALUE';
    assert.equal(safeErrorEvent(event).environment, 'production');
    delete process.env.VERCEL_ENV;
    process.env.NODE_ENV = 'development';
    assert.equal(safeErrorEvent(event).environment, 'development');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
test('reporting uses a strict allowlist; tokens, URLs, emails and exception messages never survive', () => {
  const secret = 'reader@example.test SECRET_TOKEN https://storage.test/book?token=private ABCDEF123456';
  const input = { type: undefined, event_id: 'a'.repeat(32), tags: { source: 'read-together-server', operation: 'save-progress', route: '/api/rooms/[code]/state', status: '503', secret }, request: { headers: { Authorization: secret }, data: secret }, user: { email: secret }, message: secret, exception: { values: [{ value: secret }] }, breadcrumbs: [{ message: secret }], extra: { book: secret }, contexts: { room: { notes: secret } } };
  const safe = safeErrorEvent(input); assert.equal(JSON.stringify(safe).includes(secret), false); assert.equal(safe.tags.route, '/api/rooms/[code]/state'); assert.equal(safe.event_id, input.event_id);
  assert.equal(safeErrorEvent({ type: undefined, message: secret }), null);
  const unsafe = safeErrorEvent({ type: undefined, tags: { source: 'read-together-server', route: '/api/rooms/ABCDEF123456', operation: secret, status: 400 } }); assert.equal(unsafe.tags.route,'server'); assert.equal(unsafe.tags.operation,'server-error');
});
test('no DSN reporting stays local and groups repeated operational errors', () => {
  delete process.env.SENTRY_DSN; const previous = console.error; const logs = []; console.error = value => logs.push(value);
  try { const first = reportServerError({ operation: 'unit-report', route: '/api/rooms' }); const second = reportServerError({ operation: 'unit-report', route: '/api/rooms' }); assert.equal(first, second); assert.equal(logs.length,1); assert.match(first,/^[a-f0-9]{32}$/); } finally { console.error = previous; }
});
test('Sentry fake transport receives only sanitized events and bounded drain completes', async () => {
  const envelopes = [];
  Sentry.init({ dsn: 'https://public@example.test/1', defaultIntegrations: false, enableRuntimeChannelInjection: false, beforeSend: safeErrorEvent, transport: () => ({ send: async envelope => { envelopes.push(envelope); return { statusCode: 200 }; }, flush: async () => true }) });
  Sentry.setUser({ email: 'private@example.test' }); Sentry.setExtra('token','PRIVATE_READER_TOKEN');
  Sentry.captureEvent({ type: undefined, tags: { source:'read-together-server', operation:'save-progress', route:'/api/rooms/[code]/state', status:'503' }, message:'PRIVATE_RAW_EXCEPTION' });
  assert.equal(await drainErrorReports(),true); assert.equal(envelopes.length,1);
  const serialized = JSON.stringify(envelopes); assert.equal(serialized.includes('private@example.test'),false); assert.equal(serialized.includes('PRIVATE_READER_TOKEN'),false); assert.equal(serialized.includes('PRIVATE_RAW_EXCEPTION'),false);
  await Sentry.close(100);
});
