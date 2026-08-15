---
"@surrounded-by-slop/core": minor
"surrounded-by-slop": minor
---

Multi-root workspaces now map every root instead of only the first. Paths are
prefixed with the root's name (`web/src/index.ts`) exactly as VS Code shows
them, so two roots that each contain `src/index.ts` stay separate nodes, and
the folder overview gains a useful top level: one group per root.

Each root is analyzed as its own project — its own `tsconfig` path aliases,
and import resolution that sees only that root's files — and moved into the
shared namespace afterwards by the new `rebaseGraph` transform. Doing it in
that order keeps every language resolver behaving exactly as it does in a
single-root workspace. Single-root paths are unchanged.
