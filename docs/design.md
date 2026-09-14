# Design direction

The interface adapts Apple's design guidance to a small web reader; it does not reproduce native Apple components.

- [Layout](https://developer.apple.com/design/human-interface-guidelines/layout): group related controls, use consistent spacing and safe areas, and give reading content priority.
- [Typography](https://developer.apple.com/design/human-interface-guidelines/typography): a system font, clear hierarchy, and readable supporting text. Use relative UI text sizes.
- [UI Design Tips](https://developer.apple.com/design/tips/): contrast, familiar controls, and generous touch targets. Use at least 44 CSS pixels for this web app (Apple's native guidance uses points).
- [Materials](https://developer.apple.com/design/human-interface-guidelines/materials): separate controls from content with restrained layers. Keep book text on an opaque white surface; avoid glass effects over reading content.

Implementation: cool neutral background, white grouped surfaces, blue action accent, softly rounded controls, subtle borders/shadows, visible keyboard focus, reduced-motion and increased-contrast support. Preserve all existing features, labels, room admission, Presence, highlights, and collapsed-reader behavior. Do not reintroduce previously removed copy or room metadata.

Commit stages: design rationale; home and shared control styles; reader and highlight dialog; verification evidence.
