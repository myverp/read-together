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

A separate checkout of `86dff75` serves local HTTPS with same-origin HTTP/WebSocket forwarding to only the disposable backend. The HTTPS smoke test verified a secure context, demo upload/private book access (2,748 ms) and two independent readers' Presence, with zero page errors. On resuming owner-assisted acceptance, the same smoke test passed again with visible demo text after 2,039 ms. The temporary self-signed certificate and helper scripts are ignored artifacts; no production server configuration was changed. No test emails, rooms, books or notes go to the production backend.

The owner initially postponed manual acceptance, then resumed it on 2026-09-29. An unfamiliar participant chose the demo without a hint. The owner reported visible text in less than one second, no assistance, and no Safari errors on iOS 27.2. The time is a human estimate, not an instrumented measurement. Detailed physical-device interaction results are still being collected; this observation alone does not verify invitation, annotation or audio behavior on the phone.

The first hosted F CI passed 47/48 browser cases; Linux WebKit drawings stopped at the fixture's arbitrary 35-click chapter bound. Its failure screenshot showed successful page 37 navigation near paragraph 48 of 50, still in the first chapter. The 320px wrapped toolbar and platform font/layout differences require more screens than that bound. The test now waits for every saved CFI and uses a larger bounded traversal, retaining the target-chapter and drawing absence/ownership assertions. No product code, assertion, timeout or automatic rerun was weakened to address this failure.

The corrected complete drawing scenario then passed in both local Chromium and WebKit, with TypeScript passing again. A fresh hosted run on the corrected head is required before merge.

That head passed the PR's `checks` and `integration`, but the concurrent branch-push run exposed another drawing test race: after **Jump to partner**, the test observed the old page's drawing before EPUB relocation completed, then expected it after the page changed. The failure screenshot showed the partner back on page 1 with the saved drawing absent there. The test now waits for the partner's stored CFI to match the owner's destination, then seeks the drawing on nearby pages and checks that it reappears. Pagination may place the anchored word on page 1 or 2, so absence on page 1 is not an invariant. Both CI triggers must pass on the new head before merge.

The next focused local WebKit run exposed an earlier resize race in the drawing search helper. Its trace showed the drawing become visible between the helper's first visibility check and the first Next click; the click then moved past it. The helper now walks a bounded nearby range in both directions and waits for a distinct saved CFI after every turn. The final assertion still requires the drawing to reappear after reflow. A subsequent focused run confirmed page 1 can itself contain the drawing after reflow; the temporary page-1-absence assertion was removed. The corrected complete scenario and TypeScript then passed locally in both Chromium and WebKit. This supersedes the earlier focused results. Both `checks` and `integration` passed on final PR head `0f0c2f3` in [PR CI](https://github.com/myverp/read-together/actions/runs/36613092897) and [branch push CI](https://github.com/myverp/read-together/actions/runs/36613086923). PR #5 merged as `55b5213`; the [develop merge CI](https://github.com/myverp/read-together/actions/runs/36614152572) also passed both jobs.

## Working PRs

- D: [PR #3](https://github.com/myverp/read-together/pull/3), commits `b7efb5b` and `60530fb`, merged into `develop` as `f78c265`. Both `checks` and `integration` passed on current head in [PR CI](https://github.com/myverp/read-together/actions/runs/36576762334); the branch push CI also passed. Vercel Preview succeeded; it was not used for functional tests because data isolation was not established there.
- E: [PR #4](https://github.com/myverp/read-together/pull/4), commits `84c2e44` and `8d5ad94`, merged into `develop` as `f2e6326`. Both `checks` and `integration` passed on current head in [PR CI](https://github.com/myverp/read-together/actions/runs/36578168660); branch push CI passed too.
- F: [PR #5](https://github.com/myverp/read-together/pull/5), commits `cbbf199`, `86dff75`, `9b23f31`, `ec3f171`, `10069d4` and `0f0c2f3`, merged into `develop` as `55b5213`. Both hosted jobs passed on final PR and branch-push heads, then again on the merge commit.
