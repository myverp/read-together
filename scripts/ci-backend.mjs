import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

// A separate project and ports protect the developer's running database.
const project = 'read-together-ci';
const workdir = resolve('.ci-supabase');
const command = process.argv[2];
function run(binary, args, options = {}) {
  const result = spawnSync(binary, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${binary} ${args[0]} failed: ${result.stderr}\n${result.stdout}`);
  return result.stdout;
}
const cli = args => run('supabase', [...args, '--workdir', workdir]);

if (command === 'start') {
  mkdirSync(`${workdir}/supabase/templates`, { recursive: true });
  const config = readFileSync('supabase/config.toml', 'utf8')
    .replace('project_id = "read-together"', `project_id = "${project}"`)
    .replaceAll('4532', '5732');
  writeFileSync(`${workdir}/supabase/config.toml`, config);
  writeFileSync(`${workdir}/supabase/templates/sign-in.html`, readFileSync('supabase/templates/sign-in.html'));
  // Start without application migrations: setup.sql predates the migration history.
  // Refuse a reused database rather than resetting any existing data.
  cli(['start', '--exclude', 'studio,postgres-meta,imgproxy,edge-runtime,logflare,vector,supavisor']);
  const sql = ['supabase/setup.sql', ...readdirSync('supabase/migrations').filter(file => file.endsWith('.sql')).sort().map(file => `supabase/migrations/${file}`)]
    .map(file => readFileSync(file, 'utf8')).join('\n');
  run('docker', ['exec', '-i', `supabase_db_${project}`, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
    input: `begin;\ndo $$ begin if to_regclass('public.reading_rooms') is not null then raise exception 'CI database already initialized; stop the isolated stack before starting again'; end if; end $$;\n${sql}\ncommit;\nnotify pgrst, 'reload schema';\n`,
  });
  const status = JSON.parse(cli(['status', '-o', 'json']));
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY,
    SUPABASE_SECRET_KEY: status.SERVICE_ROLE_KEY,
    CRON_SECRET: randomBytes(32).toString('hex'),
    CI_ISOLATED_BACKEND: '1',
    TEST_MAIL_URL: 'http://127.0.0.1:57324',
    PLAYWRIGHT_BASE_URL: 'http://127.0.0.1:3101',
  };
  for (const [name, value] of Object.entries(env)) {
    if (!value) throw new Error(`Supabase status did not return ${name}`);
    if (process.env.GITHUB_ACTIONS) console.log(`::add-mask::${value}`);
  }
  writeFileSync('.env.ci', Object.entries(env).map(([name, value]) => `${name}=${value}`).join('\n') + '\n', { mode: 0o600 });
  if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, readFileSync('.env.ci'));
  console.log('Isolated CI backend initialized; configuration saved to ignored .env.ci.');
} else if (command === 'stop') {
  // Never use --all: only this disposable project's volumes may be deleted.
  cli(['stop', '--project-id', project, '--no-backup']);
  console.log('Isolated CI backend stopped.');
} else {
  throw new Error('Usage: node scripts/ci-backend.mjs start|stop');
}
