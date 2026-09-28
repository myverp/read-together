import { spawn } from 'node:child_process';
import { once } from 'node:events';

// Load variables without passing --env-file into Next.js worker exec arguments.
process.loadEnvFile('.env.ci');
const child = spawn(process.execPath, process.argv.slice(2), { stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
const [code] = await once(child, 'exit');
process.exitCode = code ?? 1;
