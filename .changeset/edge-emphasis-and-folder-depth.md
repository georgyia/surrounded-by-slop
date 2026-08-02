---
"@surrounded-by-slop/core": minor
"@surrounded-by-slop/webview": minor
"surrounded-by-slop": minor
---

Give diagram edges a visual hierarchy: line thickness now tracks how often a
relationship actually occurs, type-only and inferred edges are de-emphasized,
and edges in an import cycle are drawn in a distinct colour. The rules are
shared between the interactive view and the SVG export, so what you export is
still what you saw.

Folder overviews also pick their own depth: a `src/`-rooted repo or a
`packages/*` monorepo no longer folds to a single useless box.
