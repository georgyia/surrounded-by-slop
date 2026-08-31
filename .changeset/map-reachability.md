---
"@surrounded-by-slop/cli": minor
---

The repo map now leads with the symbols a reader can actually reach. Local
closures — functions defined inside other functions — used to outrank a
module's exported API, because a helper called six times by its parent scores
well on PageRank. It is genuinely important, but only inside that one function,
so on an overview it is an implementation detail.

Exported symbols come first, then non-exported top-level ones, then closures.
Nothing is hidden: a file whose only functions are nested still lists them.
`rankNodes` is unchanged — it measures importance correctly, and `query` and
`impact` still want that measure; this is the map choosing what to ask first.
