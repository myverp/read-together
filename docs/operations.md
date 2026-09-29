# Operations and server error reporting

Stage 0 provides server-only Sentry reporting (`@sentry/node` 11.1.0). It is inactive when `SENTRY_DSN` is absent. No browser SDK, Session Replay, tracing, automatic request instrumentation or email sender is enabled.

## Activation after local implementation

Configure the private server variable `SENTRY_DSN`; do not use a `NEXT_PUBLIC_` variable. `SENTRY_RELEASE` is optional and must be a Git SHA (7–40 lowercase hexadecimal characters); otherwise the Vercel commit SHA is used, with `local` as fallback. Never commit the DSN or account credentials. Events use the allowlisted `VERCEL_ENV` (`production`, `preview`, `development`); outside Vercel they fall back to `NODE_ENV`. This prevents a production-mode Preview build from being classified as Production. See [Vercel system environment variables](https://vercel.com/docs/environment-variables/system-environment-variables#vercel_env).

Create a Sentry issue alert for a new error issue and route it to the owner's email. Set project notification frequency/rate limits to avoid a burst of repeated mail. The application groups equal operation/route events and emits at most one per minute per server process; Sentry fingerprints group them across instances. This local limiter is not a distributed delivery guarantee.

### Account connected on 2026-09-29

- Organization: `roman-borodenko`; project: `javascript-nextjs` (`4512164733124688`). The existing project was reused.
- `SENTRY_DSN` is present in ignored `.env.local` and stored as a Sensitive variable for the linked Vercel project's Production and Preview environments. No redeployment was performed. Existing deployments do not gain this integration until the Stage 0 code is released.
- [Notify Roman Borodenko](https://roman-borodenko.sentry.io/monitors/alerts/1311750/) is enabled for this project: a new issue or resolved issue regression, `source` equals `read-together-server`, owner as recipient, 30-minute throttle per issue. One rule currently covers all environments; production-only separation can be configured before release if test notifications become noisy. The existing Sentry onboarding rules were preserved.
- Sentry's default data scrubbers and **Prevent Storing of IP Addresses** are enabled. This setting affects new events, not events already ingested. The first controlled probe showed provider-derived server geography; it did not contain reader data.
- A controlled local probe received HTTP 200 and appeared as [JAVASCRIPT-NEXTJS-2](https://roman-borodenko.sentry.io/issues/150099079/), event `e5f2a223046b4a35a7dc215e7edd5ed4`, `maintenance-config`, route `/api/cron/room-maintenance`, status 503, release `local`, environment `development`.
- The owner's receipt of the Sentry **Send Test Notification** email was explicitly confirmed in chat. This verifies the notification channel independently from the SDK's event receipt; a hosted API failure and production alert remain release acceptance checks.
- A second controlled local probe after the IP setting change appeared as [JAVASCRIPT-NEXTJS-4](https://roman-borodenko.sentry.io/issues/150099903/), event `0fb43dbc801a4cf48196b6be9d2f4139`, `save-progress`, route `/api/rooms/[code]/state`, and simulated Vercel `preview` with `NODE_ENV=production`; ingestion returned HTTP 200. The Sentry UI confirms environment `preview` and the alert history records one automatic trigger for this issue. Provider-derived server geography is still shown after IP scrubbing; this is not reader geography or a claim that Sentry stores only the fields originally emitted by the application. These probes do not imply a failure on the real site.
- Both controlled test issues were marked Resolved afterward; their event records remain available for inspection.

## What is collected

Unexpected errors from API `fail()`, server request errors and partial maintenance failures report only a fixed operation label, an allowlisted route template, status, safe release and random support reference. Expected 4xx access/room errors do not report incidents. Client error messages include the reference and a retry instruction.

The reporting boundary rebuilds each event from this allowlist. Raw exception messages/stacks, request headers/body, browser or reader tokens, invitation codes, signed URLs, email addresses, book passages, highlights, notes, user context and breadcrumbs are discarded. Sentry default integrations are disabled. This deliberately trades detailed stack diagnostics for privacy; reproduce by operation, release and support reference using a disposable backend.

`captureEvent()` enqueues a safe event; Next.js `after()` keeps a bounded Sentry `flush(1000)` alive after sending the API response. A failed monitoring request never changes the reader's response or delays it. Logs still contain the same safe event when the provider is inactive. Provider receipt and email delivery require independent verification.

## Required hosted delivery acceptance check (still pending)

1. In a separate test deployment with the test project's DSN, temporarily remove backend configuration to trigger a controlled room-service 503. Record the support reference; restore configuration immediately afterward. Do not modify production data or add a public fault endpoint.
2. Verify the matching Sentry event contains only the allowlisted fields. Check its route is a template and inspect the received event for secrets and personal data.
3. Verify the owner actually received the configured alert email, record the date/reference and recipient confirmation, then resolve the test issue.
4. Confirm a room-not-found/unauthorized request produces no incident. Confirm unavailable monitoring does not hold the API response.

Local fake-transport tests verify sanitization and bounded SDK drain without sending anything to Sentry. The account-connection probes above additionally verify real provider receipt and an owner-confirmed test notification. They do not replace the hosted API acceptance check. SDK `flush()` alone is insufficient proof of receipt: a blocked local network request can still finish the SDK buffer drain; require ingestion HTTP success and a matching event in Sentry.

## Progress migration and release order

Apply the additive `add_progress_revisions` migration before publishing the new application. It adds independent position revisions, a service-only locked save function and a trigger covering legacy position changes/profile linking. Existing positions are preserved. Keep the fields during code rollback.

New clients submit their expected revision and control version. A delayed/duplicate write receives `revision_conflict`; the client rereads state and confirms an already accepted matching position, or requires an explicit local/cloud choice. Control loss takes precedence. A profile's device-local pending record is restored automatically only for the same control version; old-control records require an explicit restore after regaining control. Guests keep device storage plus Presence.

Old clients without a revision are still accepted atomically and advance the revision, but **cannot receive the new delayed-write guarantee**. Ask users to refresh old open tabs when releasing. Multiple legacy tabs can still overwrite each other or a new client's position; full transition safety requires retiring those tabs. The legacy response includes `legacyClient: true`.

The 2-second reader exit budget includes an already running request. Async page-close delivery is never promised: progress is stored locally during reading. When local storage and cloud confirmation both fail, Exit requires an explicit Stay / Exit without saving choice. A pending marker stays on this device for a later reopen.
