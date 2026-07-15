# User guide

Slop turns code into diagrams you can navigate, right inside the editor.
Install the extension, open a TypeScript/JavaScript/Python file, and run any
command below from the Command Palette (`⌘⇧P` / `Ctrl+Shift+P`, prefix
"Slop:"), the editor context menu, or the editor title button.

## Commands

| Command | What it does |
|---|---|
| **Slop: Visualize File** (`⌘⇧V` / `Ctrl+Shift+V`) | Structure + call diagram of the active file. TS/JS via the type checker; Python via tree-sitter. |
| **Slop: Visualize Function Flow** | Control-flow chart of the function under the cursor (TS/JS): condition-labeled branches, dashed loop back-edges, dimmed unreachable code, and a variable picker that highlights each variable's reads (blue) and writes (orange). |
| **Slop: Visualize Workspace** | Module map of the whole workspace, TS and Python merged. Opens collapsed to modules; very large or dense repos fold to folder level automatically. |
| **Slop: Pin Diagram** | Freeze the current diagram — it stops refreshing on save until unpinned. |
| **Slop: Follow Active Editor** | Re-visualize whenever you switch editors. |
| **Slop: Export Diagram As…** | Save the current diagram as `.drawio`, `.mmd` (Mermaid), `.svg`, or `.json`. Flow charts export their CFG faithfully in Mermaid/JSON. |
| **Slop: Copy Diagram as Mermaid** | Same as the `.mmd` export, straight to the clipboard. |

## Inside the diagram

- **Click** a node → jump to its source line. **Cmd/Ctrl-click** → open to the side.
- **Click** a collapsed module/class (▸) to expand its members; click an
  expanded container (▾) to fold it back. State survives refresh-on-save.
- **Drag** to pan, **wheel** to zoom, **double-click empty canvas** to re-fit.
- **Search box** (`/` to focus): fuzzy-matches names and paths; matches stay
  bright, everything else dims. **Esc** clears.
- **Chips** filter by node kind and top-level path; filters compose with the
  search. With exactly one match, **Isolate** slices the graph to that node's
  neighborhood; **Show all** restores the full view.
- **Hover** a node for its signature, doc summary, file:line and edge counts.
- **Legend** (top right) explains the visual language; zoomed far out, labels
  fade to keep large maps fast and readable.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `slop.include` | `**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,py}` | Globs analyzed by Visualize Workspace. |
| `slop.exclude` | `node_modules`, `dist`, `out`, `build`, `coverage` | Globs skipped everywhere. |
| `slop.includeTests` | `false` | Include `*.test.*`/`*.spec.*`/`test_*.py` files in the workspace map. |
| `slop.showExternalModules` | `true` | Show external packages and unresolved imports as dashed nodes. |
| `slop.theme` | `auto` | Diagram palette: follow the editor, or force light/dark. |
| `slop.layoutDirection` | `right` | Diagram flow direction (`right` or `down`). Flow charts are always top-down. |

## Reading the edges

Solid = calls · dashed = imports · purple = extends/implements · dimmed
dashed = heuristic (low-confidence) edges, e.g. Python calls. In flow charts:
labeled solid = branches, dashed purple = loop back, dotted = throw/finally
routes.

## Guardrails you may notice

- Workspaces past ~250 modules or ~600 edges open as a **folder-level
  overview** (with a notice) — narrow `slop.include` to drill into modules.
- Files over 512 KB and folders like `node_modules` are skipped, and a
  workspace analysis caps at 5,000 files; the log (Output → Surrounded by
  Slop) says exactly what was skipped and why.

## Privacy

All analysis runs locally in the extension host. Nothing ever leaves your
machine.
