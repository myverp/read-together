# Continuous integration

The workflow in `.github/workflows/ci.yml` has two independent jobs:

| Job | Coverage |
| --- | --- |
| `checks` | Locked dependency install, 22 deterministic unit tests, production compilation with placeholder Supabase configuration, TypeScript. |
| `integration` | Fresh local Supabase schema, production server, profile/seat/device security, drawing ownership/retries/concurrency, atomic browser and network creation limits, storage reservations, maintenance authorization and cleanup, mobile Chromium and WebKit reader/security flows. |

The integration job pins Supabase CLI **2.114.0** and uses a separate `read-together-ci` Docker project on ports **57320–57324**. Its generated configuration is under ignored `.ci-supabase/`; credentials for this local backend and a random maintenance secret are saved in ignored `.env.ci`. GitHub masks those values. No GitHub repository secrets or production services are needed, including for pull requests from forks.

## Real backend checks

`npm run test:integration` starts the production application, runs the test files serially, then stops the application:

- `checks/profile-security.test.mjs`: guest-to-profile linking, two-seat limit, account ownership, device takeover, stale-device rejection, color races, annotation ownership, private EPUB access, and denied direct browser table access.
- `checks/drawing-security.test.mjs`: admitted readers only, drawing ownership, idempotent retries, bounded payloads, concurrent writers, device control, and denied direct table access.
- `checks/upload-maintenance.test.mjs`: concurrent HTTP requests cannot pass the ten-room browser cap; hourly/daily network counters admit only the remaining slot; concurrent 25 MiB reservations cannot exceed 500 MiB; deleting a reservation restores capacity; uploaded bytes replace their reservation; unauthorized maintenance cannot mutate data; authorized maintenance deletes stale unfinished room files and rows, preserves completed/recent rooms, and prunes old counters.

Network-counter races exercise the real database function directly. Unit tests separately verify the Vercel address-to-scope mapping; a local runner cannot prove Vercel's platform header behavior. Maintenance tests invoke the HTTP handler; they do not prove Vercel's daily scheduler ran.

`npm run test:browser:ci` starts its own production server and runs only `tests/reading.spec.ts` and `tests/epub-security.spec.ts` in both configured projects (six browser cases). These cover upload/join, two-reader Presence, independent positions, Done state, reconnect/offline recovery, reopening, private EPUB URLs, third-reader rejection, corrupt upload rejection, and blocked hostile EPUB scripts/frames/refresh. Other browser suites remain available through `npm test`; they are outside this bounded CI selection. Mobile emulation does not establish physical-device behavior.

## Run the same integration job locally

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
