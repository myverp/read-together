# Read together

A small web app for two people reading the same EPUB. Read at your own pace, see where your partner is, and leave highlights with optional comments. Profiles are optional.

[Open the app](https://read-together-delta.vercel.app/)

## Features

- Upload one DRM-free EPUB (up to 25 MB) and invite a second reader with a room code.
- Read independently, see your partner's position live, or jump to their exact place.
- Mark your current position as **Done here**.
- Highlight text with an optional comment. Each reader has a consistent, distinct color.
- Draw over a visible text page, see your partner’s saved drawings, and open a drawing to view its captured text layout and strokes. Each reader can delete only their own drawings.
- Use a free email-code profile to reopen your rooms, progress, highlights, and preferred color on another device.
- Collapse the top panel for more reading space and resume from the same browser later.
- Listen to the current page with a free browser-provided voice, or with your own ElevenLabs key.

Designed for mobile screens, including Android and iOS. No library, chat, or PDF support.

## Screenshots

### Create or join a room

<img src="docs/screenshots/home.png" alt="Home screen with EPUB upload and room-code entry" width="560" />

### Read together

<img src="docs/screenshots/reader.png" alt="Reader with partner position, highlighted text, and collapsible controls" width="560" />

Screenshots show the interface; no EPUB files are included in the repository.

## Architecture

| Choice | Reason |
| --- | --- |
| **Next.js + TypeScript** | One application serves the UI and API routes. Backend secrets stay on the server. |
| **epub.js** | Renders books in the browser and provides EPUB CFI positions: pointers into text that work across different screen sizes. |
| **Supabase Realtime Presence** | Shares current position and status live. Profiles also save their last CFI and Done here state for cross-device resume. |
| **One room table + profiles** | Holds two human seats, their current control device, positions, and shared highlights. Version-checked updates prevent simultaneous changes from overwriting each other. |
| **Private Supabase Storage** | Upload the book once; admitted readers get temporary signed download URLs. |
| **Guest tokens + optional email profiles** | Guests use a random browser token. A profile uses a Supabase Auth email code and can explicitly link the browser seats it owns. |

The browser calls Next.js API routes to create/join rooms and save highlights. RLS protects room data from direct browser database access. Realtime channels use unguessable names shared only with the admitted readers; these are public channels with secret names, not authenticated private channels.

This architecture is intended for **two trusted people**, not an unrestricted public file-sharing service. A room has two human seats. A profile can reuse its own seat on another device, but a third person cannot join an occupied room.

Failed Presence updates reconnect with exponential backoff and a single pending retry. **Live** returns only after the latest position has been published successfully.

## Run locally

Requires **Node.js 24** and a Supabase project.

1. Install dependencies with `npm ci`.
2. Run [supabase/setup.sql](supabase/setup.sql), then [the profile migration](supabase/migrations/20260918152333_add_profiles_and_cross_device_seats.sql), [the drawing migration](supabase/migrations/20260922000000_add_drawing_state.sql), and [the upload guard migration](supabase/migrations/20260925151034_protect_public_room_creation.sql), in that order in the Supabase SQL editor. They create the private EPUB bucket, room/profile/annotation data, and server-only upload limits. Allow public Realtime channels; no Postgres replication publication is needed.
3. Copy [.env.example](.env.example) to `.env.local` and fill in:

   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
   SUPABASE_SECRET_KEY=YOUR_SERVER_SECRET_KEY
   ```

   Keep the secret key server-only. Environment files are ignored by Git.
4. Run `npm run dev` and open [localhost:3000](http://localhost:3000).

Create a room, then enter its code in another browser. After exiting the reader, the last room code remains in the home page's join field.

### Optional email profiles

Select **Email me a code**, enter the six-digit code from the email, then set a name, avatar, and default highlight color. Select **Link browser rooms** to explicitly attach rooms created or joined in this browser. The app never links a guest seat automatically.

An email profile can open its own room seat on a second device. Choose **Continue here** to transfer control. The previous device becomes view-only and cannot write a later position, highlight, comment, color, or audio request. A profile cannot take both room seats.

For production, configure a custom SMTP sender in Supabase Auth and use the contents of [sign-in.html](supabase/templates/sign-in.html) for both the confirmation and magic-link templates. It contains `{{ .Token }}`, which makes Supabase send a code rather than requiring an email link. The built-in Supabase sender is limited to project-team email addresses and is unsuitable for public use. See the [Supabase email OTP guide](https://supabase.com/docs/guides/auth/auth-email-passwordless) and [SMTP guide](https://supabase.com/docs/guides/auth/auth-smtp).

For Docker-based Supabase setup and detailed behavior, see [the setup guide](docs/setup-and-behavior.md).

## Deploy

Import this repository into Vercel as a Next.js project. Apply all database migrations and add the three Supabase environment variables **before building**. Add a random 16+ character `CRON_SECRET` as a server-only Production variable before deploying the daily maintenance job. Public variables are embedded in the browser bundle during the build. Use HTTPS when sharing with phones.

Room creation is limited to 10 per browser per hour, and on Vercel to 30 per client IP per hour or 100 per day. The server reserves up to 25 MiB for each incomplete upload and stops new rooms before the 500 MiB EPUB budget is exceeded. The daily maintenance job removes incomplete rooms and files after 24 hours, prunes old limit counters, and logs actual/reserved storage usage with an 80% warning. It never removes completed rooms. Check Vercel function logs and Supabase Storage usage for capacity planning; this budget is an application guard, not a billing cap.

## Listen to a page

1. Open a book and tap the headphones button.
2. **Device voice** is free and selected by default. Choose any system voice installed in the browser and a speed from 0.75x to 2x, then select **Listen to this page**. Voice availability is controlled by the device and browser.
3. Enable **Continue reading** to turn exactly one page through epub.js after each completed page, until the book ends. Manual navigation, highlights, comments, and Exit stop the speech.
4. To use **ElevenLabs**, switch modes, enter an [ElevenLabs API key](https://elevenlabs.io/app/settings/api-keys) with **Text to Speech** and **Voices read** permissions, load voices, and generate audio for the current page. It never generates following pages automatically.

The ElevenLabs key stays in memory until you exit or reload the reader. **Forget key** clears it immediately. The selected mode, system voice, speed, and Continue reading preference are stored locally; no key is stored in browser storage, the URL, Supabase, or server logs. The audio feature adds no environment variables beyond the documented Supabase configuration.

Only text between the visible page's start and end CFI is sent through a room-authorized server route to ElevenLabs. Generation uses [Multilingual v2](https://elevenlabs.io/docs/overview/models), returns MP3, and consumes your ElevenLabs credits. The provider's own data-retention terms apply. The app does not store the key, text, or audio in its database or logs. Responses are not cached; replay within the open audio window does not generate again.

Closing the audio window stops playback and cancels pending requests; cancellation cannot guarantee a refund for generation already started by ElevenLabs. The page snapshot stays fixed while settings are open so the phone keyboard does not change the text being read. Text-free pages and pages above 10,000 characters show an error rather than silently skipping or truncating text. Device voice does not require a server request; browser support and installed voices vary, especially on iPhone.

## Draw on a page

Tap the pen icon, draw with a finger, stylus, or mouse, and choose Save. Undo removes the last stroke; Clear removes all strokes in the current draft. Cancel never creates a drawing. Drawing stops audio and prevents page turns and text selection until you save or cancel. The eye button hides or shows all saved drawings on this device without changing highlights or your partner’s view. Tap a saved stroke to view the text positions and drawing captured at save time. Your own drawing can be deleted from that view.

Saved strokes are anchored to a word near the drawing with an EPUB CFI, then moved and uniformly scaled when a page reflows on another screen. The captured view stores visible word positions, measured widths, font properties, and strokes as data; it does not execute EPUB markup or preserve images. EPUB font availability can affect the reconstructed text appearance. Exact alignment with the same words on a different screen is not guaranteed. If the page size changes during an unsaved draft, cancel and start again to keep the geometry aligned. Each room can hold up to 20 drawings and 1.5 MB of drawing data.

## Checks

GitHub Actions runs `npm ci`, TypeScript, deterministic unit tests, and a production build on pushes to `main` and pull requests. It uses placeholder Supabase values only for build-time configuration; browser and database integration tests still require a separate development Supabase project.

```sh
npm run typecheck
npm run test:presence
node --test checks/elevenlabs.test.mjs
node --test checks/device-speech.test.mjs
node --test checks/drawings.test.mjs
node --env-file=.env.local --test checks/profile-security.test.mjs
node --env-file=.env.local --test checks/drawing-security.test.mjs
npm run build
npx playwright install chromium webkit
npm test
```

Browser tests need a configured Supabase backend and create rooms/uploads, so use a development project. They cover two-reader sync, private book access, highlights, reconnects, third-reader rejection, email-code profiles, guest-room linking, and device takeover. Test EPUBs are generated from original fixture text.

Tests have passed with mobile Chromium and WebKit emulation. The project owner reports earlier physical-device checks, but their device models, tested flows, and results have not been documented in [VERIFICATION.md](VERIFICATION.md); no specific hardware behavior is claimed from those checks.

Audio browser tests use a playable fixture response; provider tests check request forwarding, error sanitization, limits, and cancellation with mocked fetch. They do not validate ElevenLabs voice quality or consume real credits.

## Current limits

- A guest is tied to browser storage. A profile can use another device by explicitly taking control; only the active device can write. Clearing storage does not free a seat.
- Saving highlights requires a connection. There is no full offline book-download feature.
- Completed rooms and books remain until manually removed. Only unfinished uploads are cleaned up automatically after 24 hours.
- DRM-protected EPUBs and PDFs are unsupported. Large illustrated or fixed-layout books may behave differently.

## Code map

- `src/app/page.tsx` — upload and join screen
- `src/components/Reader.tsx` — EPUB reader and controls
- `src/lib/presence-connection.ts` — connection lifecycle and retries
- `src/lib/use-room.ts` — live positions and local resume
- `src/lib/use-highlights.ts` — shared highlights and comments
- `src/components/AccountPanel.tsx` — optional email-code profile and linked rooms
- `src/app/api/rooms/` — room admission, book access, and highlight API
- `supabase/setup.sql` — database and storage setup
