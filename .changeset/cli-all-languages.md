---
"@surrounded-by-slop/core": minor
"@surrounded-by-slop/cli": minor
---

The `sbs` CLI and MCP server now analyze every language the editor does —
Python, Go, Java, Rust, Ruby and C# as well as TypeScript/JavaScript.
Previously a mixed or non-TypeScript repo produced an empty map with no
warning: an agent asking about a Python service got a confident blank answer.

Grammars load lazily and once, so a TypeScript project pays nothing and a
long-lived MCP session parses each grammar a single time. Core gains the pure
`mergeAnalyses` transform that combines per-language results into one graph.
