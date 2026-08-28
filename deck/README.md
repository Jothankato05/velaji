# Velaji — pitch deck

A standalone page: the deck for Hackaholics 7.0, by Team Primers. Eleven 16:9
slides, arrow-key or scroll navigation, and a Download button that prints one
slide per landscape page (`@page 297x167mm`) so a reader can save it as a PDF.

Deployed to Vercel from this directory, so the URL redeploys on every push and
never drifts from the source. Kept separate from the app build because it is a
single static document with no toolchain — nothing here needs installing.

Editing: the whole deck is `index.html`, including the Primers logo as an
inlined data URI. Keep every slide's content inside its 16:9 box — the boxes
are `overflow: hidden`, so anything that spills is silently invisible rather
than obviously broken.
