# Continuous integration

CI runs on every branch push and on pull requests targeting `develop` or `main`. Both jobs must pass for the current PR before merging. Pushes and PRs have separate concurrency groups; a newer commit cancels only the superseded run in its group.

Work in short-lived `codex/<task>` branches from `develop`, then merge reviewed, green PRs into `develop`. Create a release PR from `develop` to `main` only when the user explicitly authorizes a release. `main` requires an up-to-date PR and successful `checks` and `integration` results from GitHub Actions, including for administrators; no second human approval is required, and force pushes/deletion are disabled.

Vercel's production branch is `main`; other branches use Preview. Merging into `main` triggers production deployment through the Git integration. A working-branch push, green CI, or successful preview is not release authorization. Production migrations and deployment require explicit authorization; before a release with migrations, establish migration order, old/new code compatibility, and recovery. Preview functional tests also require an isolated backend; a Preview URL alone does not establish data isolation.

The workflow in `.github/workflows/ci.yml` has two independent jobs:

| Job | Coverage |
| --- | --- |
| `checks` | Locked dependency install, 37 deterministic unit tests, production compilation with placeholder Supabase configuration, TypeScript. |
| `integration` | Fresh local Supabase schema, production server, profile/seat/device security, drawing ownership/retries/concurrency, atomic browser and network creation limits, storage reservations, maintenance authorization and cleanup, mobile Chromium and WebKit reader/security flows. |

The integration job pins Supabase CLI **2.114.0** and uses a separate `read-together-ci` Docker project on ports **57320–57324**. Its generated configuration is under ignored `.ci-supabase/`; credentials for this local backend and a random maintenance secret are saved in ignored `.env.ci`. GitHub masks those values. No GitHub repository secrets or production services are needed, including for pull requests from forks.

## Real backend checks

`npm run test:integration` starts the production application, runs the test files serially, then stops the application:

- `checks/profile-security.test.mjs`: guest-to-profile linking, two-seat limit, account ownership, device takeover, stale-device rejection, color races, annotation ownership, private EPUB access, and denied direct browser table access.
- `checks/drawing-security.test.mjs`: admitted readers only, drawing ownership, idempotent retries, bounded payloads, concurrent writers, device control, and denied direct table access.
- `checks/upload-maintenance.test.mjs`: concurrent HTTP requests cannot pass the ten-room browser cap; hourly/daily network counters admit only the remaining slot; concurrent 25 MiB reservations cannot exceed 500 MiB; deleting a reservation restores capacity; uploaded bytes replace their reservation; unauthorized maintenance cannot mutate data; authorized maintenance deletes stale unfinished room files and rows, preserves completed/recent rooms, and prunes old counters.

Network-counter races exercise the real database function directly. Unit tests separately verify the Vercel address-to-scope mapping; a local runner cannot prove Vercel's platform header behavior. Maintenance tests invoke the HTTP handler; they do not prove Vercel's daily scheduler ran.

`npm run test:browser:ci` starts its own production server and runs `tests/reading.spec.ts`, `tests/epub-security.spec.ts`, `tests/profiles.spec.ts`, `tests/progress.spec.ts`, `tests/invitations.spec.ts`, `tests/demo.spec.ts`, `tests/home.spec.ts`, `tests/highlights.spec.ts`, `tests/drawings.spec.ts`, `tests/audio.spec.ts`, `tests/reader-contents.spec.ts`, `tests/reader-settings.spec.ts` and `tests/swipes.spec.ts` in both configured projects (68 cases: 67 runnable and the Chromium-only CDP touch case explicitly skipped in WebKit). These cover upload/join, two-reader Presence, independent positions, Done state, reconnect/offline recovery, reopening, private EPUB URLs, third-reader rejection, corrupt upload rejection, and blocked hostile EPUB scripts/frames/refresh. The profile/progress selection also covers OTP/linking/takeover errors and double submission, a minute of simulated 503 retry time, unanswered requests and exit deadlines, pending recovery, offline/online, local storage errors, revision conflict choices, stale control recovery, internal EPUB links after restore, and 320/390px exit visibility. `TEST_MAIL_URL` selects the disposable mail API on port 57324. The stage 1 cases additionally cover explicit private invitation admission, clipboard fallback/Escape/focus, canonical routes and Back/Forward, rejected signed URL recovery, real demo/two-reader creation, duplicate clicks, lost upload response recovery, cancellation without ready marking, corrupt/legacy history, safe history serialization, optional email forms, small/desktop layouts, 200% text reflow, reduced motion, highlights and drawings after route refresh, and audio controls. Audio provider responses/device speech are fixtures; Windows WebKit has a documented native PCM decoding limitation, and this does not verify real ElevenLabs quality or physical-device speech. Other browser suites remain available through `npm test`; they are outside this bounded CI selection. Mobile emulation does not establish physical-device behavior.

## Run the same integration job locally

Phase 2 adds Contents and appearance coverage, including safe EPUB 2/3 navigation,
text CFI/Done across reflow/rotation/reopen, personal storage and partner independence,
author CSS/fixed-layout behavior, timeout/late callbacks, keyboard focus, annotation
and original drawing preservation, explicit Listen text and gesture blocking. See
[phase-2-validation.md](phase-2-validation.md) for evidence and the separate physical
Safari acceptance checklist.

Requires Node.js 24, Docker, and Supabase CLI 2.114.0. Leave the usual development stack running; these commands target a separate backend. Ports 57320–57324 and application port 3101 must be free.

```sh
npm ci
node scripts/ci-backend.mjs start
npm run build:ci
npm run test:integration
npx playwright install chromium webkit
npm run test:browser:ci
node scripts/ci-backend.mjs stop
```

Always run the final stop command, including after a failure. It removes only the disposable `read-together-ci` stack and its volumes. The bootstrap refuses to apply the schema again to an already initialized database; stop that isolated stack before another fresh run. It never resets the normal `read-together` development database. The maintenance/budget suite requires the explicit isolated-backend flag and local port 57321; CI security tests fail when local configuration is missing or points at a hosted service instead of silently skipping.

The GitHub job is bounded to 30 minutes, cancels superseded runs, and attempts cleanup with `always()`. On browser failure it retains the HTML report, screenshots, and UI error context for seven days. CI disables Playwright traces and video; environment files, API credentials, backend dumps, and network traces are not uploaded. API/database failures remain in the masked job log.
