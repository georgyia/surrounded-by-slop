---
"surrounded-by-slop": minor
---

Busy workspace maps now open folded to folders instead of as a wall of boxes.
The new `slop.foldThreshold` setting (default 40 modules) is a readability
line, separate from the existing layout-cost guardrails; folders stay
expandable, so it is a starting point rather than a restriction. Set it to `0`
to always open flat.
