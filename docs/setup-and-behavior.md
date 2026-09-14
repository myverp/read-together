# Read together

The smallest two-person EPUB reader: Next.js, TypeScript, Supabase Storage + Realtime Presence, and epub.js. No sign-in or accounts.

Production: [read-together-delta.vercel.app](https://read-together-delta.vercel.app). See [DEPLOYMENT.md](../DEPLOYMENT.md) for the configured hosted resources, environment handling, and production verification command.

## Run locally

Requires Node.js 22+ and a Supabase backend. Install dependencies:

```powershell
npm ci
```

### Option A: local Supabase (Docker)

With Docker Desktop running and the Supabase CLI installed:

```powershell
supabase start --exclude imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
Get-Content supabase/setup.sql -Raw | docker exec -i supabase_db_read-together psql -U postgres -d postgres -v ON_ERROR_STOP=1
supabase status -o env
```

Copy `.env.example` to `.env.local`. Use the local API URL, `ANON_KEY` for `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `SERVICE_ROLE_KEY` for `SUPABASE_SECRET_KEY`. Those local development keys also work with the SDK. The isolated stack is named `read-together`, using ports 58320–58324. Its standard Auth service supplies local API keys; the app never signs in or creates an auth user. The SQL command uses psql because CLI 2.114.0 rejects multi-statement files in `db query`.

### Option B: hosted Supabase

1. Create a project at [Supabase](https://supabase.com/dashboard).
2. Run `supabase/setup.sql` in its SQL editor. This creates one room table and one private EPUB bucket.
3. Copy `.env.example` to `.env.local` and enter the project URL, publishable key, and server-only secret key from the project's API settings. Never put the secret key in a `NEXT_PUBLIC_` variable.
4. Realtime must allow public channels (the standard default). No Postgres replication/publication setup is needed; positions use Presence.

Then:

```powershell
npm run dev
```

Open [localhost:3000](http://localhost:3000). Upload an EPUB on one browser, then enter its 12-character room code in another browser. A browser's random local token remembers its seat. The second browser downloads the same uploaded book.

## Android and iOS

Use Chrome on Android or Safari on iOS. The reader has touch-sized Previous/Next buttons, a single-page layout, rotation resizing, and safe-area padding. It reconnects and republishes the current position when the browser comes back online or returns to the foreground.

For phones, the simplest setup is a hosted Supabase project and an HTTPS deployment of this Next.js app. Configure the three environment variables on your Next.js host **before building** (`NEXT_PUBLIC_` values are embedded during the build). Run `npm run build`, then `npm start` on a Node-compatible host, or import this folder into a Next.js hosting provider.

For a same-Wi-Fi local test, use the computer's LAN IP at port 3000 and allow the local server through the firewall. If using local Supabase, set `NEXT_PUBLIC_SUPABASE_URL` to that computer's LAN IP at port 58321 and restart Next.js. A phone's `localhost` refers to the phone, not the computer. This HTTP LAN setup is for development only; use HTTPS for sharing outside your network.

Browser emulation is useful but is not a substitute for testing on actual Android/iOS devices. Device checks: select an EPUB from Files, join from the other phone, turn pages in both directions, jump to partner, toggle Done here, rotate, switch apps and return, and refresh/reopen the room.

## Behavior and limits

- One upload and exactly two permanent browser seats per room. A third browser is rejected, including when the original readers are offline.
- Positions are EPUB CFIs: stable pointers into the book, rather than screen page numbers that change with phone size. Both positions sync live. The visible `p.` label is the page within the section on that reader's screen, so different phones can show different labels for the same text. Your partner never moves your page automatically; **Jump to partner** explicitly goes to their exact position.
- **Done here** applies to the current position. Turning to a different position returns your status to Reading. The button changes to **Keep reading** while marked done.
- Select text (long-press and adjust the handles on a phone), tap **Highlight selection**, optionally add a comment, then **Save highlight**. Blank comments save only the highlight. Tap a highlight to view the note or remove your own mark.
- Each reader gets one persistent, randomly assigned color from 10 muted colors, with different colors for the two readers. Highlights render at 32% opacity and survive reopening the room. Up to 500 highlights per room, 3,000 selected characters per highlight, and 1,000 characters per comment. Saving requires a connection; failed saves keep the draft open.
- Highlights use one JSON column on the existing room row. A version-checked update protects simultaneous saves. Broadcast hints refresh the partner's authorized snapshot; reconnect and a visible-page 15-second fallback repair missed hints. No extra tables or accounts are required.
- Each browser saves its own position/status locally and caches its partner's last received state. Offline partner information is labeled last seen. Presence supplies fresh state when connected; the server does not keep reading history.
- Failed Presence publications and subscription errors explicitly replace the channel with 1, 2, 4, 8, 16, then 30-second retry delays. A single pending retry handles overlapping browser events; offline pauses retries. Live is restored only after the replacement subscription successfully publishes the latest local position.
- Reopen the room using the same browser. Clearing browser storage loses that seat; make a new room if it happens. One active tab per reader is expected.
- DRM-free EPUBs, up to 25 MB. No PDF. EPUB code is blocked by a script-src none Content Security Policy installed before each section is rendered. The iframe allows parent-installed event listeners so touch input works in WebKit; forms, popups, and top navigation remain sandbox-restricted. Heavy illustrated/fixed-layout books can behave differently or exceed a phone's memory.
- Room codes are invitations. The first other browser with the code gets the second seat. Database rows have RLS enabled and no anonymous access; private files use temporary signed URLs. Realtime uses a random 256-bit channel capability returned only to the two seats. These are public Supabase channels with unguessable names, not authenticated private channels. Readers who have the channel capability must be trusted.
- Intended for two trusted people, not an unrestricted public upload service. The per-browser creation cap is an accident guard, not abuse prevention. Uploads/rooms remain until manually removed in Supabase; incomplete uploads may leave unused room rows. No library or cleanup UI is included.

## Verify

Start/configure Supabase first, then:

```powershell
npm run typecheck
npm run test:presence
npm run build
npx playwright install chromium webkit
npm test
```

Tests use real local Supabase, real uploads, and two isolated browser contexts. They cover CFI sync, independent navigation, jump to partner, both Done here states, reopen, offline/online recovery, rotation, third-reader rejection, and invalid EPUB input. They create test rooms in the configured project, so use a development project. The EPUB fixture is generated locally from original test text.

`test:presence` uses Node.js 24's built-in test runner and TypeScript support, with simulated timers and failures to verify retry delays, cleanup, and stale callback handling. The browser reconnect test also injects failing track replies into test-only WebSocket traffic while keeping the real Supabase server connection.

`@xmldom/xmldom` is pinned through an override to 0.8.15 to replace epub.js's vulnerable transitive parser. The app loads epub.js only in the browser.

## Source map

- `src/app/page.tsx`: upload/create/join
- `src/components/Reader.tsx`: EPUB rendering and reader controls
- `src/lib/use-room.ts`: live Presence, local resume state, reconnect
- `src/lib/use-highlights.ts` and `src/components/HighlightDialog.tsx`: shared marks and optional notes
- `src/app/api/rooms/`: upload capability and atomic second-seat admission
- `supabase/setup.sql`: room table, grants, private bucket

Implementation references: [epub.js](https://github.com/futurepress/epub.js), [Supabase Presence](https://supabase.com/docs/guides/realtime/presence), [Next.js App Router](https://nextjs.org/docs/app).

