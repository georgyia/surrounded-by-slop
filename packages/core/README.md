# @surrounded-by-slop/core

The editor-independent analysis engine behind Surrounded by Slop: source text
in, deterministic Semantic Graph IR out. It contains TypeScript/JavaScript and
Python adapters, graph transforms, ELK layout, and JSON, Mermaid, SVG, and
draw.io exporters. It performs no telemetry or source upload.

```ts
import {
  analyzeTypeScriptProject,
  collapseToModules,
  mermaidExporter,
} from "@surrounded-by-slop/core";

const { graph, diagnostics } = analyzeTypeScriptProject([
  { path: "src/app.ts", text: "export function run() {}" },
]);

const diagram = mermaidExporter.export(collapseToModules(graph));
```

Inputs are supplied by the caller, keeping filesystem/editor concerns outside
the package. Graphs and exports are canonicalized for byte-identical output
from identical input. Requires Node.js 20.19 or newer.

See the [IR specification](https://github.com/georgyia/surrounded-by-slop/blob/main/docs/ir-spec.md)
and [architecture documentation](https://github.com/georgyia/surrounded-by-slop/blob/main/docs/architecture.md).
