# Production deployment

App: https://read-together-delta.vercel.app

## Hosted resources

- Vercel: `romans-projects-dedca1a7/read-together` (Hobby), project `prj_5AgwNS3nu596HDJxdoxKqFPuDzHY`.
- Supabase: `read-together`, project `vttukyiegxkrfyneeblz`, organization `Roma`, Frankfurt (`eu-central-1`), Free plan.
- Acornic was paused with explicit approval to release the second free-project slot. Its data was not deleted. Resuming it while keeping both other free projects active may require a plan change.

## Architecture and access

One `public.reading_rooms` table with RLS enabled. There are intentionally no browser-access policies: browser roles have no table grants, and the server checks reader tokens before using its secret key. The service role has only SELECT, INSERT, UPDATE, DELETE grants on this table.

The `shared_room_highlights` migration adds `highlight_state` JSON to that same table. It stores the highlights, optional plain-text comments, two persistent reader colors, and a revision. Server-side compare-and-swap retries concurrent writes; only the original seat can delete a mark. Highlights sync through a Broadcast invalidation hint on the existing room channel, followed by an authorized API fetch. Reconnect and a 15-second visible-page fallback reload missed updates. There are no new tables, accounts, keys, or infrastructure.

One private `epubs` bucket, limited to 25 MB EPUB uploads. No anonymous Storage policies. The server issues signed upload and download URLs. Room creation, seat admission, and shared book access use the existing Next.js routes.

Realtime Presence uses the existing public-channel mode with random 256-bit topic names disclosed only to admitted seats. Both readers must be trusted. No authentication, user accounts, extra app tables, replication publication, or extra service was added. Hosted Supabase's standard internal schemas remain managed by Supabase.

The hosted migration `reading_rooms_and_private_epubs` contains `supabase/setup.sql`. Re-running that SQL is safe for this schema. The security advisor's informational `RLS Enabled No Policy` notice is expected for this server-only table, not a missing public access policy.

## Environment

The following were added to Vercel **Production before the build**:

| Variable | Vercel storage |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Non-sensitive public configuration |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Non-sensitive publishable key |
| `SUPABASE_SECRET_KEY` | Sensitive server-only secret |
| `CRON_SECRET` | Random 16+ character server-only Production secret for daily cleanup |

Modern `sb_publishable_` and `sb_secret_` keys are used. Real values are excluded by `.gitignore` and `.vercelignore`. `.env.production.local` is a private local copy; `.env.local` retains the local development backend. The source archive contains only `.env.example`. Apply `supabase/migrations/20260925151034_protect_public_room_creation.sql` before deploying code that calls `create_reading_room`. `vercel.json` schedules `/api/cron/room-maintenance` once daily; its handler requires `CRON_SECRET` and reports EPUB usage in function logs.

## Redeploy

From this folder, using the already-linked Vercel CLI:

```powershell
npm ci
npm run typecheck
npm run build
vercel deploy --prod --yes --scope romans-projects-dedca1a7
```

Vercel builds remotely using its Production variables. If a public Supabase variable changes, redeploy to rebuild the browser bundle. Never pass the server key as a public variable or commit its value.

## Test production

```powershell
$env:PLAYWRIGHT_BASE_URL = 'https://read-together-delta.vercel.app'
npm test
Remove-Item Env:PLAYWRIGHT_BASE_URL
```

This uses isolated mobile-sized Chromium/WebKit contexts against the actual HTTPS deployment. It creates small test EPUB rooms in the hosted project. See `VERIFICATION.md` for results and hardware-testing limits.
