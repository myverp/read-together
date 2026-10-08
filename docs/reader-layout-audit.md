# Reader layout audit — 2026-10-08

Scope: review the supplied reader mockup and the requirements implemented in
[PR #14](https://github.com/myverp/read-together/pull/14), starting from
`develop` at `bdddf57`. This is interface acceptance, not a production release.

## Finding and correction

**P2: clicking outside the menu stopped working after rotation.** Opening the
menu and rotating the viewport replaces the EPUB iframe during reflow. The menu
subscribed only to the original iframe document; pointer events in its replacement
did not reach the parent page. A new browser regression reproduced the failure in
both Chromium and WebKit before the fix.

`ReaderMenu` now observes replacement frames and their load events while open,
attaches outside-click handling to their documents, and removes the observer and
all listeners when closed. The EPUB reflow/navigation implementation is unchanged.
The regression passes with the menu still open after rotation, then closes on a
real click in the new iframe and verifies that the saved reading position matches.

## Requirements reviewed

| Requirement | Evidence |
| --- | --- |
| Icon-only Menu/Exit; ordered overlay menu; separate Room details and Reading settings | Reader diff and layout browser assertions; screenshots inspected |
| Previous / Done here / Draw / Next; separate eye outside text | Four-button footer and geometry assertions at 320px, low height and desktop; drawing interaction retained |
| Keyboard and focus | Arrow/Home/End/Escape behavior, Tab to Exit, every menu panel's initial focus and restoration |
| Light/Dark/Sepia | Menu and header background assertions; screenshots inspected; existing settings tests cover font size, storage and partner independence |
| Save status | No persistent success row; simulated network failure shows local-only wording; simultaneous network/storage failure shows unsaved wording and retains the explicit unsafe-exit choice |
| Existing reader behavior | Diff retains EPUB/CFI, progress queue, annotations, drawings, audio, swipes and partner mechanisms; existing browser suites retain their behavior assertions |

## Validation and boundaries

- Local: 42 unit tests, production CI build and TypeScript passed.
- Local isolated `read-together-ci`: all 16 layout/progress cases passed across
  Chromium and WebKit, including the reproduced rotation regression.
- The hosted CI selection now contains 72 cases: 71 runnable plus the existing
  Chromium-CDP-only touch case skipped in WebKit. Hosted results belong to the
  audit PR's exact commit and must be green before merge.
- Physical phones/Safari, assistive-technology devices, and real provider/device
  audio playback remain unverified. Browser emulation and audio fixtures are not
  evidence for those boundaries.
- The previously reproduced concurrent profile-creation race is recorded in
  Linear BLA-27. It is an existing backend issue outside this layout correction;
  no backend or production data was changed by this audit.
