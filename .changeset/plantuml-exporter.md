---
"@surrounded-by-slop/core": minor
"surrounded-by-slop": minor
---

New PlantUML exporter: save any diagram as `.puml`. Like Mermaid, it has two
targets — the call/import graph renders as `rectangle`s in `package` blocks,
and the class view renders a real UML class diagram with visibility, return
types, generalization and realization. Heuristic, type-only and `implements`
edges stay dotted and dimmed, so a guess never reads as a fact.
