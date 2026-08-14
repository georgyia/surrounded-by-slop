---
"@surrounded-by-slop/core": minor
"surrounded-by-slop": minor
---

New Graphviz DOT exporter: save any diagram as `.dot` and pipe it into
Graphviz (`dot -Tpng`) or anything else that speaks DOT. Containers become
`subgraph cluster_*` boxes, node shapes and colours follow the same palette as
every other export, and heuristic, type-only and `implements` edges stay dashed
so a guess never reads as a fact. The shared palette now lives in
`packages/core/src/export/styles.ts`, where every exporter reads it.
