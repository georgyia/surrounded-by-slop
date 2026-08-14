---
"@surrounded-by-slop/core": minor
"surrounded-by-slop": minor
---

Java support: `.java` files now analyze into the semantic graph — classes,
interfaces, enums, records, methods and constructors, with `import a.b.C`
resolved to the file in the project (through Maven/Gradle source roots) and
heuristic same-file calls.

Also fixes a latent bug in the tree-sitter mapper: two declarations sharing a
qualified name — Java overloads, or a redefined Python function — minted the
same node id and produced a graph that failed validation. Ids are now
allocated through `IdAllocator`, as the TypeScript adapter has always done.
