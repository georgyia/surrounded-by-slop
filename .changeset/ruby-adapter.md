---
"@surrounded-by-slop/core": minor
"surrounded-by-slop": minor
---

Ruby support: `.rb` files now analyze into the semantic graph — modules,
classes, instance/singleton/setter methods, `require_relative` resolution and
heuristic same-file calls. Nesting means `module A; class B` yields qualified
names like `A.B.method` for free.

What a syntax-only pass cannot see is documented rather than guessed:
`define_method`, `method_missing`, `include`d modules and other
metaprogramming are invisible, methods inside `class << self` are attributed
to the enclosing class without being marked as class methods, and every call
edge is a name-match guess drawn dimmed and marked low-confidence.
