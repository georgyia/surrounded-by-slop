---
"@surrounded-by-slop/cli": minor
---

`sbs export` now offers every layout-free format — Graphviz DOT and PlantUML
join Mermaid and JSON. The set is derived from the exporter registry rather
than restated in the command, so a future layout-free exporter appears
automatically and a layout-dependent one (SVG, draw.io) still cannot be
requested from a headless pipe.
