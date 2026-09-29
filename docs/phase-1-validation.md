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

## F — simple start and final regression coverage

The first screen offers Try demo, Open your EPUB and Have an invitation. Validated legacy history supplies a compact Continue reading action; optional titles stay local. Email is behind Sign in, while authenticated profiles keep their existing rooms, customization and explicit linking. Forms submit with Enter and show errors next to the relevant action. Local history now serializes only code, seat and optional title, rather than leaking extra fields from a full Room object.

The product has a favicon, apple icon, generic social preview, accessible loading status and clear error/404 screens. The room route continues to have generic private metadata. The existing palette is retained. The README includes a new inspected 390px homepage screenshot and updated behavior; CI selects all 48 relevant browser cases, including highlights, drawings and audio.

Local verification, 2026-09-29:

- All 37 unit tests, build and TypeScript passed. All 14 focused Chromium/WebKit drawing, highlight, invitation and home cases passed together.
- The final full browser selection passed all 48 cases in one complete run (13.3 minutes on Windows while the separate phone checkout was being built). The expanded CI browser step has a 16-minute bound; the whole integration job retains its 30-minute limit. Clean-browser demo readiness in this run was 2,673 ms Chromium and 5,497 ms WebKit on local loopback.
- All eight real isolated API/database/Storage/maintenance cases passed after the full browser run. The final unit suite and TypeScript were rerun successfully.
- The full browser run initially exposed obsolete test steps that clicked Join after refresh. Since a known room now reopens through admission on its route, those clicks were removed; persistence assertions were retained. The drawing response listener now starts before refresh.
- New coverage replaces a deliberately rejected signed book URL on refresh through fresh admission. Home checks cover keyboard submission, hidden optional email, corrupt and legacy history, reduced motion, 320/390/1280px layouts and 200% text reflow at a 640px CSS viewport. Native browser zoom is a separate manual check; text reflow is not reported as native 200% zoom.
- The 390px home and 320px invitation screenshots were visually inspected; no clipping or horizontal overflow was found. No browser errors were reported during those inspections.
- Native Chrome for Testing Page zoom was set to 200% in browser settings. The resulting CSS viewport was 631px with devicePixelRatio 2; no horizontal overflow occurred. The full homepage screenshot was inspected, and Tab focused Try demo with a visible solid outline.

Physical iPhone/Safari and an unfamiliar person's onboarding are pending owner-assisted acceptance. A separate checkout of `86dff75` serves local HTTPS with same-origin HTTP/WebSocket forwarding to only the disposable backend. The HTTPS smoke test verified a secure context, demo upload/private book access (2,748 ms) and two independent readers' Presence, with zero page errors. The owner received the local address and acceptance scenario. The temporary self-signed certificate and helper scripts are ignored artifacts; no production server configuration was changed. No test emails, rooms, books or notes go to the production backend.

The owner postponed this manual acceptance on 2026-09-29 and asked to finish delivery now. Implementation and automated verification can be delivered to `develop`; the complete stage acceptance criteria remain open until the physical-phone and unfamiliar-person results are recorded. Neither emulated WebKit nor the HTTPS smoke test substitutes for those results. The local test services will be stopped; the prepared checkout can be reused when acceptance resumes.

## Working PRs

- D: [PR #3](https://github.com/myverp/read-together/pull/3), commits `b7efb5b` and `60530fb`, merged into `develop` as `f78c265`. Both `checks` and `integration` passed on current head in [PR CI](https://github.com/myverp/read-together/actions/runs/36576762334); the branch push CI also passed. Vercel Preview succeeded; it was not used for functional tests because data isolation was not established there.
- E: [PR #4](https://github.com/myverp/read-together/pull/4), commits `84c2e44` and `8d5ad94`, merged into `develop` as `f2e6326`. Both `checks` and `integration` passed on current head in [PR CI](https://github.com/myverp/read-together/actions/runs/36578168660); branch push CI passed too.
