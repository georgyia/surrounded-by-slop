---
"@surrounded-by-slop/core": minor
"surrounded-by-slop": minor
---

C# support: `.cs` files now analyze into the semantic graph — namespaces,
classes, interfaces, structs, enums, records, methods, constructors and local
functions, with heuristic same-file calls.

`namespace` uses the IR's `namespace` kind, so a namespace is a container
without being a type: a function inside one stays a function, while a method
inside a class still becomes a method. The tree-sitter mapper gained that
`@namespace.def` capture, available to every future language.

`using` directives render as external module nodes: a C# namespace has no file
mapping — one namespace can span many files and the folder convention is not
enforced — so guessing a file would be confidently wrong.
