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
