export function localBackend(baseDefault = 'http://localhost:3101') {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const base = process.env.PLAYWRIGHT_BASE_URL || baseDefault;
  const local = value => {
    try { return ['localhost', '127.0.0.1'].includes(new URL(value).hostname); }
    catch { return false; }
  };
  const configured = local(url) && local(base)
    && !!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY && !!process.env.SUPABASE_SECRET_KEY;
  if (process.env.CI && !configured) throw new Error('CI integration tests require a configured local Supabase backend and local application URL.');
  return { url, base, local: configured };
}

export function isolatedBackend() {
  const config = localBackend();
  if (!config.local || process.env.CI_ISOLATED_BACKEND !== '1' || new URL(config.url).port !== '57321') {
    throw new Error('Maintenance/budget tests require the disposable CI backend on port 57321. Run scripts/ci-backend.mjs start.');
  }
  return config;
}
