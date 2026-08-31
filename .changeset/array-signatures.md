---
"@surrounded-by-slop/core": patch
---

Array types no longer render as `{}` in signatures. `noLib` is deliberate — the
core touches no filesystem and analysis is byte-identical everywhere — but it
leaves `Array<T>` unresolved, so `string[]` printed as `{}` in the repo map,
hover cards and the Mermaid/PlantUML class diagrams. `(): {}` does not read as
"unknown"; it reads as "returns an empty object", which is a specific and wrong
claim.

Signatures now prefer the type the author actually wrote, falling back to the
checker where they wrote none. A return type that cannot be resolved is left
off rather than asserted, and an annotation from a file that failed to parse is
distrusted, so a partial graph never becomes a malformed one.
