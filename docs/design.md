# Design direction

The interface adapts Apple's design guidance to a small web reader; it does not reproduce native Apple components.

- [Layout](https://developer.apple.com/design/human-interface-guidelines/layout): group related controls, use consistent spacing and safe areas, and give reading content priority.
- [Typography](https://developer.apple.com/design/human-interface-guidelines/typography): a system font, clear hierarchy, and readable supporting text. Use relative UI text sizes.
- [UI Design Tips](https://developer.apple.com/design/tips/): contrast, familiar controls, and generous touch targets. Use at least 44 CSS pixels for this web app (Apple's native guidance uses points).
- [Materials](https://developer.apple.com/design/human-interface-guidelines/materials): separate controls from content with restrained layers. Keep book text on an opaque white surface; avoid glass effects over reading content.

Implementation: cool neutral background, white grouped surfaces, blue action accent, softly rounded controls, subtle borders/shadows, visible keyboard focus, reduced-motion and increased-contrast support. Preserve all existing features, labels, room admission, Presence, highlights, and collapsed-reader behavior. Keep book metadata private before admission. A compact Invite action may expose the room invitation link and code inside a dialog after admission; never include book titles or reader secrets in shared previews.

Commit stages: design rationale; home and shared control styles; reader and highlight dialog; verification evidence.

Stage 1: lead with the shared-reading value and demo/personal-book actions. Keep email sign-in optional behind a button, show a compact device-local continue action and keep explicit profile linking. Preserve cool neutrals, white surfaces and blue accent. Forms provide nearby errors and announced progress; invitations use a modal with Escape and focus return. Product previews contain generic copy only.
