# Surrounded by Slop

See the code you'll never read — automatic, navigable diagrams for your
codebase, inside VS Code and Cursor. Built for the age of AI-generated code:
when nobody read what was written, the map is how you stay oriented.

Everything runs locally. No code ever leaves your machine.

![Visualize a file, then map the workspace](https://raw.githubusercontent.com/georgyia/surrounded-by-slop/main/assets/workspace-map.gif)

## What you get

- **Visualize File** (`⌘⇧V`) — structure + call diagram of the current file.
  TypeScript/JavaScript with real type-checker resolution; Python via
  tree-sitter.
- **Visualize Workspace** — a module map of the whole repo, TS and Python on
  one canvas. Busy repos open as a folder overview you drill into, rather than
  a wall of boxes; folders expand to modules, modules to their members.
- **Visualize Function Flow** — a control-flow chart of the function under
  your cursor: labeled true/false branches, loop back-edges, unreachable code
  dimmed and badged, and a per-variable read/write overlay.
- **Navigate** — click any box to jump to its source line; search, filter
  chips, isolate a node's neighborhood, hover for signatures.
- **Export** — draw.io, Mermaid, SVG, or raw JSON; what you export is exactly
  what you saw.

### Diagrams you can actually read

The map is weighted, not just correct. Line thickness tracks how often a
dependency is really used, so the load-bearing edges stand out from one-off
references. Type-only imports — erased before your code ever runs — are
de-emphasized instead of competing for attention, and modules caught in an
import cycle are drawn in their own colour.

Monorepos are first-class: imports between workspace packages resolve to their
source, so the folder overview shows real package-to-package dependencies
instead of disconnected boxes.

![Call graph with hover details and filter chips](https://raw.githubusercontent.com/georgyia/surrounded-by-slop/main/assets/media/gallery-1-callgraph.png)

## Quick start

1. Install, open any TypeScript or Python file.
2. `⌘⇧V` (or right-click → *Visualize File*).
3. Click a box — you're at its declaration. That's the loop.

![Right-click to visualize the function under the cursor](https://raw.githubusercontent.com/georgyia/surrounded-by-slop/main/assets/media/gallery-2-invoke.png)

Settings live under **Surrounded by Slop** (`slop.*`): include/exclude globs,
test-file handling, external modules, theme, layout direction, and
`slop.foldThreshold` — how busy a map has to get before it opens folded.

## For AI agents, too

The same analysis ships as a headless CLI and an MCP server, so an agent can
ask the graph instead of grepping: `sbs map` for a ranked, token-budgeted repo
map, `sbs query callers/callees/path` to follow real edges, and `sbs impact` for
the blast radius of a diff.

## Honest by design

Heuristic edges (e.g. Python calls) are drawn dimmed and marked
low-confidence — the diagram never pretends to know more than the analyzer
does. Guardrail messages tell you when something was skipped or folded, and
the Output panel says why.

Docs, roadmap, contributing:
[github.com/georgyia/surrounded-by-slop](https://github.com/georgyia/surrounded-by-slop)
