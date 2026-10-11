# Demo EPUB

`story.md` is original English text created for the Read Together demo. It contains no quotations or adapted passages from other books. The story, generated EPUB and accompanying package markup may be copied, modified and redistributed for any purpose, with or without attribution. No external book or portfolio-video asset is used.

Rebuild the committed EPUB with `node scripts/build-demo.mjs`. The generator is a development script; production fetches `/demo/read-together-demo.epub` from its own origin and uses the same validation, room limits and private Storage upload as a personal EPUB. The three chapters support page turns, selections and ordinary two-person invitations. There is no simulated partner.
