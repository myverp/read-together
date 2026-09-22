# Drawing annotation validation

Validated locally on 2026-09-22 against local Supabase. Production was not changed.

- Production build and TypeScript checks passed.
- Presence: 8 checks passed.
- Existing swipe/highlight browser checks: 7 passed, 1 intentionally skipped.
- Audio browser checks: all 8 scenarios passed (one rerun after development-server reload interference).
- Drawing validation unit checks and local API security checks passed.
- Drawing browser flow passed in mobile Chromium and WebKit emulation: save,
  retry with the same ID, partner visibility, hide/show, narrow-screen reflow,
  reload, chapter boundaries, original view, owner deletion, pointer cancellation,
  and multi-touch interruption.
- API checks cover outsider access, forced ownership, partner deletion rejection,
  invalid/oversized payloads, concurrent writes, active-device takeover, and
  denial of direct room-table reads by browser roles.

The narrow-screen browser check waits for epub.js to finish rendering before
turning another page. Physical iPhone and Android devices have not been tested.

## Accepted limits

Drawings keep their shape and follow a text anchor, but reflow can change their
alignment with individual words. The original view preserves recorded text and
stroke geometry in a scrollable viewport; it is not an EPUB screenshot and does
not capture images or guarantee embedded-font reproduction. Resizing an unsaved
draft requires cancelling and restarting. Saved data is capped at 20 drawings
and 1.5 MB per room.

Apply the drawing migration to the hosted database before deploying this feature.
