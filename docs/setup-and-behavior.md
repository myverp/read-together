# Read together

The two-person EPUB reader: Next.js, TypeScript, Supabase Storage + Realtime Presence, and epub.js. Read as a guest or use an optional email profile to continue across devices.

Production: [read-together-delta.vercel.app](https://read-together-delta.vercel.app). See [DEPLOYMENT.md](../DEPLOYMENT.md) for the configured hosted resources, environment handling, and production verification command.

## Run locally

Requires Node.js 24 and a Supabase backend. Install dependencies:

```powershell
npm ci
```

### Option A: local Supabase (Docker)

With Docker Desktop running and the Supabase CLI installed:

```powershell
supabase start --exclude imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
Get-Content supabase/setup.sql -Raw | docker exec -i supabase_db_read-together psql -U postgres -d postgres -v ON_ERROR_STOP=1
supabase status -o env
```

Copy `.env.example` to `.env.local`. Use the local API URL, `ANON_KEY` for `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `SERVICE_ROLE_KEY` for `SUPABASE_SECRET_KEY`. Those local development keys also work with the SDK. The isolated stack is named `read-together`, using ports 45320–45324 (outside the Windows port reservation encountered during development). Never commit these credentials. Apply any missing migrations in `supabase/migrations/` after the base setup when upgrading an existing database. The SQL command uses psql because CLI 2.114.0 rejects multi-statement files in `db query`.

Local sign-in emails stay in Mailpit at `http://127.0.0.1:45324`; they are not sent to real recipients. Both signup and repeat sign-in templates show a code. Enter the code in the app to finish signing in. Restart the local stack after changing Auth email templates.

### Option B: hosted Supabase

1. Create a project at [Supabase](https://supabase.com/dashboard).
2. Run `supabase/setup.sql`, then the profile, drawing, and upload guard migrations in `supabase/migrations/`, in filename order. For an existing installation, apply only missing migrations after reviewing them.
3. Copy `.env.example` to `.env.local` and enter the project URL, publishable key, and server-only secret key from the project's API settings. Never put the secret key in a `NEXT_PUBLIC_` variable.
4. Realtime must allow public channels (the standard default). No Postgres replication/publication setup is needed; positions use Presence.
5. For email profiles, enable the Email provider and configure custom SMTP under Supabase Auth. Set both **Confirm signup** and **Magic Link** email templates to the contents of `supabase/templates/sign-in.html`, which uses `{{ .Token }}`. Use an eight-digit OTP to match the local configuration and sign-in form. Set the Site URL to the deployed application. Supabase's default mail sender is restricted to project-team addresses and is not a production email service. See [email OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless) and [SMTP setup](https://supabase.com/docs/guides/auth/auth-smtp). Keep SMTP credentials in Supabase Auth settings, never in application code or Git.

Then:

```powershell
npm run dev
```

Open [localhost:3000](http://localhost:3000). Choose **Try demo** for a short original EPUB or **Open your EPUB** for a DRM-free file up to 25 MB. The reader opens at `/room/[code]`. **Invite** gives a private link and a room code; a new visitor explicitly chooses **Join room**, so loading/prefetching the invitation does not take a seat. Both readers download the same private book. A browser's random local token remembers its seat.

The home page accepts the complete same-origin invitation link or a spaced 12-character code. Unknown domains, extra path segments and URL query/fragment additions are rejected. Refresh and Back/Forward recheck access and fetch a fresh book URL; Exit returns home. A guest gets a compact **Continue reading** action for this browser. Signing in stays optional behind **Sign in**; rooms are linked only with the explicit **Link browser rooms** action.

The demo consumes an ordinary room/Storage reservation and supports a real partner, highlights and drawings. A saved demo offers continuation; **Start another demo** is an explicit new room. Creation blocks duplicate clicks, preserves a received reservation for upload retry and reconciles a successful upload whose response was lost. Cancelling an in-flight Storage transfer may still allow bytes to arrive, but does not admit/mark the room ready; the existing cron owns unfinished cleanup. An unknown outcome of the initial creation POST has no server idempotency guarantee.

## Android and iOS

Use Chrome on Android or Safari on iOS. The reader has touch-sized Previous/Next buttons, a single-page layout, rotation resizing, and safe-area padding. It reconnects and republishes the current position when the browser comes back online or returns to the foreground.

For phones, the simplest setup is a hosted Supabase project and an HTTPS deployment of this Next.js app. Configure the three environment variables on your Next.js host **before building** (`NEXT_PUBLIC_` values are embedded during the build). Run `npm run build`, then `npm start` on a Node-compatible host, or import this folder into a Next.js hosting provider.

For a same-Wi-Fi local test, use the computer's LAN IP at port 3000 and allow the local server through the firewall. If using local Supabase, set `NEXT_PUBLIC_SUPABASE_URL` to that computer's LAN IP at port 45321 and restart Next.js. A phone's `localhost` refers to the phone, not the computer. HTTP on a LAN address lacks secure-context APIs used by clipboard and annotation identifiers; use local HTTPS when validating the complete phone flow, and HTTPS for sharing outside your network. Stage 1 acceptance uses the separate disposable backend on port 57321, not the normal development database.

Browser emulation is useful but is not a substitute for testing on actual Android/iOS devices. Device checks: select an EPUB from Files, join from the other phone, turn pages in both directions, jump to partner, toggle Done here, rotate, switch apps and return, and refresh/reopen the room.

## Behavior and limits

- The reader has icon-only Menu and Exit controls above the book. Menu opens Contents, Listen, Reading settings, Invite, Partner and Room details over the page. Room details contains positions, connection state and highlight colors. The bottom row is Previous, Done here/Keep reading, Draw and Next; the separate eye toggles drawings. Buttons have accessible names, tooltips and visible focus; menu supports arrow keys, Escape and outside dismissal, with focus returning after panels close.
- Successful saves do not occupy a permanent status row. Storage/sync failures, local-only pending changes and conflict recovery keep their existing messages and retry/choice actions.

- **Contents** shows nested EPUB 3 navigation or EPUB 2 NCX. Missing/unusable navigation falls back to the book's linear sections. Titles are plain text; external, unsafe and missing destinations cannot be opened. The current section is identified without pretending to know the exact fragment. A successful transition saves a real EPUB CFI; Exit waits for relocation. A failed transition retains the last confirmed position and offers retry.
- **Reading settings** offers 16/18/20/22/24/26/28 px and Light/Dark/Sepia. Changes apply immediately; **Reset** restores Light/18 px, Georgia with 1.6 line spacing. Settings belong to this browser, apply across books, and never change the partner's appearance. Only validated version/theme/fontSize are stored under `read-together:reading-settings:v1`; unavailable storage keeps the session usable and shows a warning. Open tabs do not synchronize appearance. Fixed-layout EPUBs explicitly disable text sizing.
- Changing appearance or rotating preserves the confirmed text CFI and Done state. Screen page labels can change after reflow. Audio stops; the next explicit Listen reads the new visible page, without an automatic ElevenLabs request. Contents/Settings are unavailable while editing a drawing or a highlight/comment draft. Saved annotations keep their original text anchors; the original drawing snapshot keeps its saved appearance. Both new dialogs support keyboard navigation, Escape, scrolling and return focus to their trigger.
- One upload and exactly two permanent reader seats per room. A profile can reopen its own seat on another device; another person cannot take a third seat. Exit closes the reader without freeing its seat.
- Positions are EPUB CFIs: stable pointers into the book, rather than screen page numbers that change with phone size. Both positions sync live. The visible `p.` label is the page within the section on that reader's screen, so different phones can show different labels for the same text. Your partner never moves your page automatically; **Partner** in the reader menu explicitly goes to their exact position.
- **Done here** applies to the current position. Turning to a different position returns your status to Reading. The button changes to **Keep reading** while marked done.
- Select text (long-press and adjust the handles on a phone), tap **Highlight selection**, optionally add a comment, then **Save highlight**. Blank comments save only the highlight. Tap a highlight to view the note or remove your own mark.
- Each reader gets one room color from 10 muted colors, distinct from their partner's. Profiles supply a preferred default, with a room-specific alternative when that color is occupied. Changing the room color recolors all of that reader's existing highlights in the room. Highlights render at 32% opacity and survive reopening. Up to 500 highlights per room, 3,000 selected characters per highlight, and 1,000 characters per comment. Saving requires a connection; failed saves keep the draft open.
- Highlights use one JSON column on the room row. A version-checked update protects simultaneous saves. Broadcast hints refresh the partner's authorized snapshot; reconnect and a visible-page 15-second fallback repair missed hints.
- Guest positions remain browser-local. Profile positions and Done here are also saved on the server so another device can resume at the last successfully saved CFI. Presence supplies live partner state. There is no timeline of reading history.
- Failed Presence publications and subscription errors explicitly replace the channel with 1, 2, 4, 8, 16, then 30-second retry delays. A single pending retry handles overlapping browser events; offline pauses retries. Live is restored only after the replacement subscription successfully publishes the latest local position.
- Guests reopen rooms in the same browser; clearing its storage loses the guest credential. After signing in, explicitly link browser rooms to the profile to preserve their seats and annotations. Another device signed into that profile reuses its existing seat; **Continue here** transfers control and stops the former device from writing progress. Profiles do not create extra seats.
- DRM-free EPUBs, up to 25 MB. No PDF. EPUB code is blocked by a script-src none Content Security Policy installed before each section is rendered. The iframe allows parent-installed event listeners so touch input works in WebKit; forms, popups, and top navigation remain sandbox-restricted. Heavy illustrated/fixed-layout books can behave differently or exceed a phone's memory.
- Room codes are invitations. The first other browser with the code gets the second seat. Database rows have RLS enabled and no anonymous access; private files use temporary signed URLs. Realtime uses a random 256-bit channel capability returned only to the two seats. These are public Supabase channels with unguessable names, not authenticated private channels. Readers who have the channel capability must be trusted.
- Intended for two trusted people, not an unrestricted public upload service. Room creation has browser and Vercel client-IP limits plus a 500 MiB EPUB creation budget. A daily server job removes incomplete uploads after 24 hours; completed rooms remain until manually removed in Supabase. No library or deletion UI is included.

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

