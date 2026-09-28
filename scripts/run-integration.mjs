import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout } from 'node:timers/promises';
import { isolatedBackend } from '../checks/local-backend.mjs';

const { base } = isolatedBackend();
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3101'], { stdio: 'inherit' });
server.on('error', error => { console.error(error.message); });
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null) throw new Error('Production server exited before becoming ready.');
    try { ready = (await fetch(base, { signal: AbortSignal.timeout(1000) })).ok; } catch {}
    if (ready) break;
    await setTimeout(500);
  }
  if (!ready) throw new Error('Production server did not become ready within 30 seconds.');
  const tests = spawn(process.execPath, ['--test', '--test-concurrency=1', 'checks/profile-security.test.mjs', 'checks/drawing-security.test.mjs', 'checks/upload-maintenance.test.mjs'], { stdio: 'inherit' });
  const [code] = await once(tests, 'exit');
  process.exitCode = code ?? 1;
} finally {
  if (server.exitCode === null) {
    const stopped = once(server, 'exit');
    server.kill();
    const forceStop = globalThis.setTimeout(() => server.kill('SIGKILL'), 5000);
    try { await stopped; } finally { globalThis.clearTimeout(forceStop); }
  }
}
