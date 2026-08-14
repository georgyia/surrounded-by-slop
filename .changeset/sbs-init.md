---
"@surrounded-by-slop/cli": minor
---

New `sbs init`: writes a short pointer block into `AGENTS.md` (creating it if
missing) that tells coding agents to ask the graph instead of grepping, and
creates a `CLAUDE.md` importing `@AGENTS.md` when there isn't one. It is a
pointer, never a generated dump — content outside the markers is left
byte-identical, and re-running produces no diff. `sbs init --check` exits 1
when the block is missing or stale, so CI can guard it.
