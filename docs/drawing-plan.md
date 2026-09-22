# Drawing annotations: agreed MVP

Readers can draw over the visible EPUB text, save their drawing, and see their
partner's saved drawings. A local eye toggle temporarily hides drawings without
changing highlights or deleting shared data.

## Interaction

- Enter drawing mode explicitly. Stop reading audio and temporarily block text
  selection and page navigation while drawing.
- Offer a pen using the reader's room color, width, undo, clear, cancel, and save.
- Save only nonempty drawings. Keep failed saves available for retry.
- Tapping a saved drawing opens its captured text composition; only its author
  can delete it. Identify the author with a label, not color alone.
- Publish a change notification after a successful save/delete. Recover missed
  notifications when returning online or to the page and by periodic refresh.

## Position and original view

Store an EPUB CFI anchor, the original surface dimensions, text-run geometry,
and numeric freehand strokes. Resolve the anchor against the currently rendered
EPUB and move/scale each drawing as one object, preserving its aspect ratio.

The original view preserves captured text positions and stroke geometry. It is
a text composition, not a screenshot of every EPUB image or embedded font.
When text reflows on another screen, exact alignment with individual words is
not guaranteed. This is an accepted limitation; the original view provides the
context. Do not deform strokes to attempt per-word alignment.

## Implementation boundaries

- Keep epub.js navigation, Presence, CFI resume, highlights, comments, and audio.
- Isolate drawing capture/rendering and persistence from existing reader logic.
- Reuse room identity, seat ownership, and active-device checks at the API.
- Use a bounded, revisioned drawing payload with compare-and-swap updates.
  Reject malformed/nonfinite coordinates and excessive payloads. Never render
  submitted HTML or executable SVG.
- Keep room data private. No new auth model, public storage, dependencies,
  collaborative live cursor, or per-stroke streaming.

## Verification

Check create/save/reopen/delete with both room seats; reject outsiders, partner
deletion, stale devices, malformed inputs, and excessive payloads. Check canceled
and empty drawings, retry/idempotency, hide/show, navigation, touch interruption,
rotation, narrow screens, chapter changes, and cleanup. Run TypeScript, build,
existing Presence checks, and relevant reader regressions. Report simulated
mobile browser evidence separately from physical-device validation.
