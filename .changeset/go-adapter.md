---
"@surrounded-by-slop/core": minor
"surrounded-by-slop": minor
---

Go support: `.go` files now analyze into the semantic graph (types, funcs,
methods, imports, heuristic calls) and appear on workspace maps alongside
TypeScript and Python. The extension's tree-sitter languages are now a table
rather than per-language code, so the next grammar is a row and a wasm copy.

Honest limits, documented in the user guide: Go imports name a package
directory while module nodes are per-file, so they render as external nodes
until `go.mod` resolution exists; methods appear as functions, since a Go
method sits beside its type rather than inside it.
