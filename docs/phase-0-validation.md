# Stage 0 verification

The records below are chronological. The original local-only limitations were superseded by the publication and hosted follow-up records at the end of this document.

Date: 2026-09-29. Local application implementation; no push, deployment or production migration. Sentry account connection was subsequently requested and configured; see the follow-up below. The owner later requested three local commits grouping progress, monitoring, and planning/verification documents.

The reading flow now records a local pending position before one serial cloud queue, submits device control plus server revision, reconciles lost responses, offers explicit conflict recovery and keeps Exit visible with a two-second sync budget. Continue here has a visible busy/error state and rejects duplicate submissions.

## Verification record

- Unit tests: **34 passed / 0 failed / 0 skipped**. Includes six retry delays and limit, terminal HTTP statuses, Retry-After, coalescing, cleanup/abort, immediate update→exit flush, active unanswered request deadline, lost-response reconciliation, conflict choice, takeover precedence, synchronous failures, legacy/corrupt/full/blocked local storage, Sentry event privacy and fake transport drain.
- TypeScript: passed.
- Production build against isolated CI configuration: passed.
- Real isolated API/database integration tests: **8 passed / 0 failed / 0 skipped**. Profile suite now verifies atomic revisions, same-revision concurrent writes, stale delayed writes, lost progress-response recovery contract, stale-control priority, same-device repeated takeover, legacy PATCH revision increment and denied public RPC execution. Existing drawing, upload-budget and maintenance regressions passed.
- Chromium/WebKit browser suite on the final production application build: **16 of 18 passed in the full run**, then **2 of 2 profile cases passed in a focused rerun**. The initial two profile failures were a test-only text selector matching both the connection status and the new alert. The corrected selector targets the connection status. All 18 scenarios passed across these runs; no application code changed between them. Browser cases also verify bounded retries/exit, pending restore, both storage failures, local/cloud choices, and Continue here error/concurrency handling.
- The final browser coverage includes internal EPUB links after restoring a text anchor: navigation saves the destination CFI and reopening preserves that exact CFI. Reflow keeps the text anchor, while book links/page turns replace it; failed display restores the current anchor.
- WebKit screenshots at 320px with collapsed details and 390px with expanded details were visually inspected: Exit stays visible, controls fit and no horizontal overflow occurs. Chromium screenshots were also reviewed.

The disposable `read-together-ci` Supabase project uses ports 57320–57324. The normal development database was neither reset nor migrated. Bootstrap's first migration attempt exposed a SQL syntax error; its transaction rolled back, the source was corrected and fresh initialization then passed.

## Remaining acceptance outside local scope

Hosted CI for a new published commit is unverified because publication was not requested. Production migration remains unapplied. Sentry delivery from a hosted API and production activation remain pending deployment; see [operations.md](operations.md). Physical phones and real speech-provider calls were not tested. Mobile Chromium/WebKit are emulation.

## Sentry account connection follow-up, 2026-09-29

The existing Sentry project is connected in ignored local configuration and Vercel Production/Preview Sensitive variables. A controlled local sanitized event was accepted with HTTP 200 and verified in Sentry as `e5f2a223046b4a35a7dc215e7edd5ed4`. The owner confirmed receipt of the test notification email. A source-filtered new/regressed issue rule with a 30-minute throttle is enabled for the owner. IP address storage is disabled for new events; default scrubbers remain enabled.

Preview environment classification now uses allowlisted `VERCEL_ENV` before `NODE_ENV`. The four focused error-reporting tests and TypeScript check passed after this change. A second controlled probe (`0fb43dbc801a4cf48196b6be9d2f4139`) was accepted with HTTP 200 after enabling IP scrubbing, verified in the Sentry UI as `preview`, and automatically triggered the configured alert once. Sentry still adds server geography; it is not reader information. The raw JSON download was blocked by the browser (`ERR_BLOCKED_BY_CLIENT`); inspection used the event details UI and local serialization tests. No application build, database migration or browser suite was rerun for this small server reporting change; the build and broader results above precede it. No production fault was induced and no real reader data was transmitted.

Before creating the three local commits, the complete unit suite was rerun against the final application code: **35 passed / 0 failed / 0 skipped**. Commit grouping changes only the Git history; it does not deploy the application or apply the production migration. Local environment credentials and the unrelated portfolio video directory are excluded.

## Publication and hosted follow-up, 2026-09-29

The owner authorized the production migration and publication. Migration `20260928153442_add_progress_revisions.sql` was applied to the existing production project, preserving all 84 rooms and their positions. The remote migration history matches the repository version. Commits `42679ca`, `69723d8` and `2e504ee` were pushed to main; production deployment `dpl_G5WB1wkWdzUhWsyKEPCA76sWPZ2p` became READY on `2e504ee13be2d11301899a843992e8e3fe47cced`, and the live homepage returned HTTP 200.

[Hosted CI run 36541361280](https://github.com/myverp/read-together/actions/runs/36541361280) passed checks and all eight API/database/Storage/maintenance cases, but browser coverage passed 17/18: Chromium profile reopen returned to page 1. This was a real reader race, not a reason to weaken the profile assertion.

### Reader navigation correction (BLA-20)

epub.js `next()`/`prev()`/`display()` resolve before `relocated` is emitted on a later animation frame. Exit could unmount the reader and flush its previous CFI before that event. A deterministic regression delays the animation frame by 500 ms, clicks Next then Exit, and verifies both a changed cloud CFI and the same CFI after reopening. On the old code it failed because the cloud position remained `epubcfi(/6/2!/4/2/1:0)`.

The reader now waits for both the navigation operation and its relocation event, with a five-second deadline and listener/timer cleanup. Exit and Done here stay disabled during that short transition; failed transitions release the controls and show an error. The existing two-second cloud flush budget remains unchanged.

Both the original profile scenario and the new regression passed in Chromium and WebKit (4/4). Unit tests passed 35/35, build and TypeScript passed. A broader run then exposed a separate WebKit fixture race: removing the conflict panel changes pagination and saves a new page label between the test's GET and PATCH. The trace showed the same CFI with revisions 3 then 4; the test's stale revision 3 correctly received 409. The simulated second tab now reads the latest revision and rebases only explicit `revision_conflict` responses, at most three times. Application conflict assertions and browser test retries remain unchanged. Its focused Chromium/WebKit cases passed 2/2.

After the fixture correction, the complete isolated browser suite passed **20/20**, followed sequentially by all **8/8** real API/database/Storage/maintenance checks and TypeScript. No tests were skipped. This correction is prepared separately from production main; hosted CI and release status are tracked in BLA-20 and the linked pull request.

### Hosted Sentry verification (BLA-21)

A separate protected preview of published `2e504ee`, without production backend credentials or `CRON_SECRET`, returned a controlled 503 from `/api/cron/room-maintenance` at **08:37:57 UTC**. API support reference `1e3026843ddb471b9289e2fb40752713` exactly matched the event received in [Sentry issue JAVASCRIPT-NEXTJS-2](https://roman-borodenko.sentry.io/issues/150099079/). The event showed `environment=preview`, release `2e504ee13be2d11301899a843992e8e3fe47cced`, operation `maintenance-config`, the route template, source `read-together-server`, and status 503. Visible event fields contained no reader tokens, room codes, signed URLs, emails or book content. Sentry added the hosted server's Ashburn geography. Raw JSON remained unverified; strict serialization privacy is covered by the unit suite.

[Notify Roman Borodenko](https://roman-borodenko.sentry.io/monitors/alerts/1311750/) automatically triggered at **08:38 UTC**. The owner explicitly confirmed receipt of this new automatic email, separately from the earlier Send Test Notification. The controlled issue was resolved after inspection. A missing-token POST to `/api/rooms` returned 401 without an error ID or new incident.

A second disposable preview overrode only its own Sentry destination with an unreachable local address. Controlled 503s still returned with TTFB **0.862 s** (maintenance) and **0.543 s** (room creation), without successful monitoring delivery. These requests created no room or uploaded book, and changed no production configuration/data. Both disposable deployments were removed after verification; the project-level Sentry configuration remains enabled.
