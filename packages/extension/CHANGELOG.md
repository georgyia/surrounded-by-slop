# Changelog

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
