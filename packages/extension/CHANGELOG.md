# Changelog

## 0.1.3

- Resolve `tsconfig` path aliases (`@/*` and friends) on the workspace map.
  They previously resolved to nothing, so a project's own code was drawn as
  external packages and almost no internal edges appeared. On a stock Next.js
  app this took internal import edges from 3 to 132 and removed four invented
  `@/…` package boxes. `extends` chains, comments and trailing commas in
  tsconfig are all handled; a project without a tsconfig behaves as before.
  The Output panel now says which aliases were applied, or why none were.

## 0.1.2

- Fix `.mjs`, `.cjs`, `.mts` and `.cts` files being silently missing from the
  workspace map. They were collected by the include glob and then dropped by
  the TypeScript adapter, so a repo's config and script files just weren't
  there — with nothing to say why. `.mjs`/`.cjs` are also parsed as JavaScript
  now rather than TypeScript.

## 0.1.1

- Add the marketplace listing icon. 0.1.0 shipped without one and both
  listings fell back to a placeholder.

## 0.1.0

First public release.

- **Visualize File** (`⌘⇧V`) — structure and call diagram of the current file.
  TypeScript/JavaScript resolved through the real type checker; Python via
  tree-sitter.
- **Visualize Workspace** — a module map of the whole repo, TS and Python on one
  canvas. Opens collapsed; dense repos fold to a folder overview instead of a
  hairball.
- **Visualize Function Flow** — control-flow chart of the function under the
  cursor: labeled true/false branches, loop back-edges, unreachable code dimmed
  and badged, plus a per-variable read/write overlay.
- **Navigate** — click any box to jump to its source line; search, filter chips,
  isolate a node's neighborhood, native right-click menu on diagram nodes.
- **Export** — draw.io, Mermaid, SVG or raw JSON; the export matches what's on
  screen.

Heuristic edges are drawn dimmed and marked low-confidence. Everything runs
locally; no code leaves your machine.
