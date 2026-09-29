# Stage 1 delivery

Implementation follows packages D, E and F in [phase-0-1-plan.md](phase-0-1-plan.md). The base is `develop` at `1986a8d`. Packages A/B/C are already present; their evidence is in [phase-0-validation.md](phase-0-validation.md).

## D — room addresses and invitations

`/room/[code]` owns admission and the dynamically loaded reader. The home form, uploads and profile room buttons navigate through this entry point. A new invitation visitor must explicitly join; known local/profile rooms are rechecked through the API. Refresh and browser history request fresh admission and book URLs. Exit navigates to `/` and preserves any save warning. Lowercase codes redirect to their canonical uppercase address.

The invitation dialog exposes only the origin, route and room code, restores keyboard focus after Escape, and confirms copying only after Clipboard succeeds. Foreign links, extra segments, credentials and query/fragment additions are rejected. The route has generic metadata, noindex and a no-referrer policy; it does not serialize the book or reader credentials.

Local verification, 2026-09-29:

- 36 unit tests passed; build/TypeScript and diff checks passed.
- All 8 real API/database/Storage/maintenance tests passed.
- All 24 selected Chromium/WebKit browser scenarios passed in one complete run, including the existing progress, profile/takeover and hostile-EPUB regressions and four new invitation cases.
- The first invitation run identified missing focus restoration in Safari: pointer clicks do not focus the trigger. The trigger now receives focus explicitly; the unchanged focus assertion passes in both engines.
- The invitation page at 320px was visually inspected with agent-browser; it fits without clipping or overflow. No browser errors were reported.

Tests use only the disposable Supabase on ports 57320–57324. Hosted CI and each package PR are recorded below when completed. No production release is authorized by this work.

## E — original demo and shared creation

The committed 6,754-byte EPUB has three original chapters, a navigation document, its Markdown source, a reuse permission and a deterministic development generator. Production fetches the asset from the application's origin and uses the same EPUB parsing, room reservation and private Storage transfer as a personal file. A real partner joins the ordinary second seat; the demo does not simulate anyone.

One active creation blocks repeated clicks. A known reservation is retained in memory for retries, including reconciliation when the upload succeeded but its reply was lost. Cancellation stops subsequent admission; a Storage transfer already in flight may finish, and the existing unfinished-room cron owns cleanup. Returning visitors can continue their saved demo or explicitly start another.

Local verification, 2026-09-29:

- Build/TypeScript and diff checks passed. All six demo cases passed together in Chromium/WebKit; the four existing upload/two-reader/corrupt-book cases also passed against this implementation.
- Clean-browser homepage → original visible demo text: 2,730 ms Chromium and 4,228 ms WebKit on local loopback to the isolated application/backend. These are measured local results, not a promise for remote or slow networks.
- A lost successful upload reply produced one room and one upload, then recovered on manual retry. Cancellation left the database room `ready=false` and never opened Reader. Double-click and continue did not create another room.
- The first lost-response fixture used Playwright `route.fetch`, which forwarded empty binary multipart data in Windows WebKit. The fixture now lets the browser upload its real body and discards only the completed reply; product assertions remain unchanged.

An unknown outcome of the initial room-creation POST is still outside a “never duplicates” guarantee: no server idempotency key was introduced. The current reservation is retryable only after its code was received. No schema migration is needed.

## Working PRs

- D: [PR #3](https://github.com/myverp/read-together/pull/3), commits `b7efb5b` and `60530fb`, merged into `develop` as `f78c265`. Both `checks` and `integration` passed on current head in [PR CI](https://github.com/myverp/read-together/actions/runs/36576762334); the branch push CI also passed. Vercel Preview succeeded; it was not used for functional tests because data isolation was not established there.
