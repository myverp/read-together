# Physical-device testing note — 25 September 2026

The project owner reports that physical-device checks were performed earlier but were not recorded here. The device models, browsers, dates, tested flows, and results are not documented, so this note does not claim that any specific feature passed on Android or iOS hardware. Statements below that say physical devices were not tested or verified describe the scope of those dated runs, not the full history of the project.

# Page narration verification — 14 September 2026

- TypeScript: passed.
- ElevenLabs adapter: 5 deterministic tests passed (request contract, limits, sanitized errors, voices, cancellation); no real key or credits used.
- Audio UI/API: 4 tests passed on mobile Chromium/WebKit against local Next.js and hosted room authorization. Speech/voices responses were fixtures. Covered page boundaries, voice memory, forgetting the key, quota errors, cancellation, and unauthorized access. Native playback/pause passed on Chromium.
- Windows WebKit limitation: an independent blank-page PCM probe also failed with media error 4. Its audio integration test therefore checks the UI/data flow but excludes native decoding assertions. Physical iPhone playback and real ElevenLabs generation remain unverified.
- Existing reader regression: 11 passed, 1 expected WebKit skip (Chromium-only CDP touch). Covers two-reader Presence, private book access, third-reader rejection, highlights/comments, resume, and swipes across chapters.
- Presence lifecycle: 8 deterministic tests passed.
- No database migration or new deployment secret required. API key and selected voice live only in React memory until reader exit/reload; no key enters browser storage or the room data.

The audio window reads a snapshot of the visible page. Closing it aborts pending work and releases playback. Generation sends text to ElevenLabs; provider retention/billing still applies. The application makes no automatic retries of billable speech calls.

# Production verification — 8 September 2026

The app was tested at https://read-together-delta.vercel.app against hosted Supabase project `vttukyiegxkrfyneeblz`, not mocks or the local database. Vercel deployment: `dpl_9RgVPkgfHXc3LJUuMaRDYZSbwkt5` (Production, READY).

| Check | Result |
| --- | --- |
| Local production build, TypeScript, and Vercel production build | Passed |
| Supabase security advisor | No warnings/errors; expected INFO: RLS enabled with no public policies |
| Android-sized Chromium browser tests | 2 passed |
| iPhone-sized WebKit browser tests | 2 passed |
| Browser runtime errors in the two-reader flows | None |
| Signed EPUB download | Succeeds and returns EPUB ZIP bytes |
| Same EPUB without a token / through public Storage URL | Both denied |
| Room table access using publishable browser key | Denied, PostgreSQL 42501 |
| Public production URL without Vercel login | HTTP 200 |
| Final hosted data check | 2 ready test rooms, 2 occupied seats per room, 2 EPUB objects, 0 auth users |

The two-reader test uploads a generated EPUB, creates and joins a room, checks live CFI propagation in both directions, confirms independent navigation, jumps to the partner's CFI, syncs both Done here states, restores state after reload/rejoin, changes position offline and resyncs on reconnect, rotates the viewport, checks horizontal overflow, and rejects a third browser. The other test rejects corrupt EPUB input.

All 4 production browser tests passed in 1.2 minutes. Mobile screenshots were inspected. These are desktop browser engines using phone-sized viewports and touch emulation. Actual Android/iOS hardware, native file pickers, and OS background suspension were not tested. The internet deployment itself was tested over HTTPS.

No authentication or additional app tables were added. Public Realtime channels are enabled, and successful live Presence synchronization confirms the hosted configuration. The [RLS advisor notice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) is intentional: browser roles must never query this table. Access is through server routes and signed URLs.

The two small generated test EPUB rooms remain in the hosted project. Acornic was paused with explicit approval to free the required Supabase Free-plan slot; its data was not deleted. Deployment details and secret-handling instructions are in DEPLOYMENT.md.

## Collapsible reader header (2026-09-08)
Production deployment dpl_7g68DyGQAw4rJ83772DT7tEX9XWT adds a collapsible room/position panel. Collapsed mode retains Jump to partner and an accessible expand arrow. Both mobile engines verified that details hide, reading height increases by more than 60 pixels, and expanding restores the height. Duplicate EPUB relocation updates are ignored to avoid unnecessary Presence traffic during reflow. All four production Playwright tests passed after this fix (1.3 minutes); physical devices remain untested.

## Shared highlights and optional comments — 9 September 2026

Production deployment: dpl_2ZycXSCa8WvU8pR26RWqUvE2JMez. All 6 production Playwright tests passed in 2.0 minutes (3 Chromium, 3 WebKit), with TypeScript and the Vercel build passing. The original two-reader flow remains covered.

New checks: selected text becomes a 32%-opacity highlight with or without a comment; a whitespace-only comment stays blank; the partner receives and opens marks; note text is rendered safely as plain text; failed saves retain the draft; each reader keeps one randomly assigned color and the two colors differ; marks/comments survive reopening and rotation; own-mark deletion syncs; simultaneous saves do not overwrite one another; outsiders cannot read/write marks and readers cannot delete their partner's marks. Mobile screenshots were inspected.

WebKit needs a parent-page selection fallback and direct SVG tap targets because callbacks from sandboxed EPUB frames were unreliable. EPUB scripts remain disabled. Automated tests set DOM text ranges and perform touch taps in phone-sized browser engines; physical Android/iPhone long-press handles and software keyboards remain untested.

Hosted verification confirms one public app table, RLS enabled, the new highlight_state column, zero auth users, and only service-role table grants. Security advisor reported no warnings/errors; its existing [RLS Enabled No Policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) informational notice is intentional for server-only access. Test rooms contain generated original EPUB text.

## Presence reconnect recovery — 9 September 2026

Production deployment: dpl_8yhXwzepz5nhdM8xPhmJqaHLC14o. TypeScript and the Vercel production build passed. Eight deterministic Presence tests passed, followed by all eight production browser tests (Chromium/WebKit) in 2.8 minutes.

The original failure path changed status text but never explicitly rejoined after a failed track. Presence now has one lifecycle owner for retry timers, channel removal, subscription callbacks, and serialized publications. Errors, timeouts, and rejected track promises trigger retries at 1/2/4/8/16/30 seconds, capped at 30 seconds. The delay resets only after successful publication on the replacement subscription. Overlapping online/foreground events share one pending attempt; offline/unmount cancels timers. Old-channel callbacks cannot overwrite current status or start extra attempts. Live requires a successful track acknowledgement, and updates made during an in-flight track are sent afterwards.

Deterministic checks cover retry growth/cap/reset, initial and later publication failures, track serialization, cleanup ordering, stale callbacks, duplicate events, offline/resume, and unmount. Production WebSocket tests inject two initial track error replies and a later publication error, verify the rejoin counts and minimum delays, then confirm Live and the partner's latest CFI. Existing highlights, comments, upload, room admission, private EPUB access, and two-reader navigation tests also passed. No schema or environment changes were needed.

## UI cleanup - 2026-09-09
Removed the requested home copy, reader title/code, and highlight hint. Exit is now at the right of the reader positions row, including mobile layouts. TypeScript and the Vercel production build passed. Production reading tests passed on Android Chromium and iOS WebKit, including collapse/expand, two-reader sync and offline recovery. Mobile screenshots inspected. Physical devices were not tested.
Deployment: dpl_CdBJ5NoAZAADf3Xrar68DVoi7ukq.


## Apple HIG-inspired visual update — 2026-09-14

- Changed CSS only: system typography, grouped home surfaces, blue action hierarchy, compact reader controls, and refined highlight dialog. Existing application logic and labels remain unchanged.
- Design sources and rationale: docs/design.md.
- Passed: TypeScript, Vercel production build, all 8 deterministic Presence tests.
- Read-only in-app browser inspection confirmed the deployed homepage layout.
- Production: https://read-together-delta.vercel.app/; deployment dpl_GibwtYdtvsEKt5dN1BFZQTxY8vPf, code commit 2cab0f5.
- Pending: redesigned reader/dialog visual inspection and mobile Chromium/WebKit regressions. Two test launches were rejected by automatic approval review because its model was at capacity. No new end-to-end pass is claimed.
- Commits are local; no GitHub push was requested for this change.

## Swipe checks — 2026-09-14

Tested local source fb5083a using the configured backend and generated EPUB fixtures. Added tests/swipes.spec.ts.

- Chromium: passed left/right position equivalence to buttons, one page per gesture, short/vertical/multitouch/long-press rejection, selection/dialog blocking, and recovery after closing the dialog.
- Chromium: separate native CDP touch-input test passed for one left swipe inside the iframe.
- WebKit: failed the first synthetic left swipe; CFI remained at the initial position although Next/Previous buttons worked. iOS swipe support is not verified. Further diagnosis is required; no application fix was made during this test request.
- Not covered in this run: chapter-transition listener renewal, highlight-hit gestures, native selection handles, physical devices, and listener cleanup after exit.
- Initial test harness issues (WebKit Touch constructor and sandboxed-frame timers) were corrected before the reported results. Tests now dispatch synthetic handler events from the parent; only the dedicated Chromium test uses native browser touch injection.

## iPhone swipe fix and Supabase stability — 2026-09-14

Diagnosis: in WebKit, the scripts-disabled EPUB sandbox suppressed all touch listeners, including parent-installed callbacks. A minimal diagnostic recorded no callbacks on the window, document, or body. It was not a Supabase fault.

After the user's explicit approval to investigate the security change, the section content hook installs CSP before epub.js serializes and loads each document. It rejects unsupported section structures, puts the policy before book content, and removes book-supplied refresh/policy meta tags. Script execution, object/frame/worker loads, base changes and form submissions are denied; remaining iframe sandbox restrictions still apply. The iframe now permits the trusted parent's event listeners. Reference: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src

Local verification against the hosted backend:
- All 8 integration tests passed: two-reader sync, private storage access, third-seat denial, highlights/comments, offline recovery and explicit retry/backoff after failed Presence tracks.
- All 8 deterministic Presence tests passed; TypeScript passed.
- Swipe guards passed in Chromium and WebKit; a native CDP touch swipe also passed in Chromium.
- Adversarial EPUB checks passed in both engines: inline/external scripts, inline event handlers, iframe srcdoc and meta refresh did not execute or replace the book. WebKit native device touch/selection handles still need physical iPhone validation.
- Supabase project ACTIVE_HEALTHY; performance advisors empty. The sole security advisor is informational (RLS enabled without policies), intentional because anon/authenticated have no SELECT grant while service_role does. The epubs bucket remains private, capped at 25 MiB.

These are bounded checks, not a long-duration uptime guarantee. No database or Supabase configuration changes were needed.

Section-transition and room-reopen swipe checks passed in both engines. Production deployment remains pending explicit approval: automatic review limited the prior authorization to research and local tests.

