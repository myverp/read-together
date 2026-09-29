# Stage 0 local verification

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
