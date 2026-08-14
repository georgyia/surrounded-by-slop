---
"@surrounded-by-slop/core": minor
"surrounded-by-slop": minor
---

Rust support: `.rs` files now analyze into the semantic graph — modules,
structs, enums, traits, unions, impl blocks and functions, with `mod`,
`crate::`, `super::` and `self::` resolved across the module tree and
heuristic same-file calls.

Methods live in `impl Foo { … }` rather than inside the type, so the impl
block is captured as the container that holds them: methods come out as
`Foo.bar` with no special-casing, and a type with an impl appears as two boxes
— the type and the impl — which is faithful to Rust, where a type can have
several impl blocks.
