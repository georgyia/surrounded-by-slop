# Semantic Graph IR — Specification (v1)

The Semantic Graph is the single interchange format of this project. Language
adapters produce it; transforms, exporters and the webview consume it and
nothing else. The TypeScript types in
[`packages/core/src/ir/types.ts`](../packages/core/src/ir/types.ts) are the
normative shape; this document defines the semantics.

## Versioning

`schemaVersion` is a single integer, currently `1`. It bumps only on breaking
changes to shapes or semantics. Additive optional fields do not bump it.
Consumers must reject graphs with an unknown version rather than guess.

## Determinism (normative)

Identical input must produce **byte-identical** serialized graphs, across
runs, platforms and machines:

- Node identity never derives from traversal order, pointers or hashes of
  unstable inputs — see the id grammar below.
- A graph is *canonical* when `nodes` and `edges` are each sorted by `id`
  (code-unit order). Adapters and transforms must return canonical graphs;
  `canonicalizeGraph` is the single sorting point.
- Serialization uses `stableStringify` (sorted object keys). Never serialize
  a graph with bare `JSON.stringify`.
- No timestamps, tool versions, absolute paths or environment data inside the
  graph.

## Paths and spans

All paths are relative to the analysis root and use forward slashes on every
platform. Spans are 1-based for both lines and columns; `endCol` points one
past the last character, matching editor selection conventions.

## Id grammar

```
node-id  = kind ":" path                      ; modules
         | kind ":" path "#" qualified-name   ; everything inside a module
         | kind ":external:" package          ; external packages
         | "function:unresolved#" name        ; shared unresolved-call sinks
         | "folder:" path                     ; collapse transforms only
edge-id  = kind ":" from-id "->" to-id
```

Examples: `module:src/app.ts`, `class:src/app.ts#Server`,
`method:src/app.ts#Server.start`, `function:src/util.ts#outer.inner`,
`module:external:react`.

`qualified-name` joins the container chain with dots (`Namespace.Class.member`).
When two same-kind declarations collide on the same qualified name (e.g.
same-named functions in sibling blocks), later occurrences in source order get
a `~2`, `~3`… suffix; the first stays unsuffixed. Renaming a declaration
therefore changes only its own id (and its incident edges) — nothing else in
the graph moves.

## Node kinds and capture rules (TypeScript adapter, v1)

| Kind | Captured from |
| ---- | ------------- |
| `module` | every analyzed source file; external packages (`external: true`, no span) |
| `namespace` | `namespace X { … }` declarations, nested included |
| `class` | class declarations |
| `interface` | interface declarations (members are **not** captured in v1) |
| `enum` | enum declarations |
| `function` | function declarations, `const f = () => …` / function expressions (any nesting depth), default exports (anonymous ones are named `default`) |
| `method` | methods, constructors (`constructor`), get/set accessors, arrow-function class properties |
| `variable` | **exported** module-level variables without a function initializer |
| `folder` | produced only by `collapseToFolders` |

Overload signatures merge into one node with their implementation. `exported`
covers modifier exports, export lists (`export { x }`) and default exports.

Deliberate v1 limits (documented, not accidental): no property nodes, no
interface members, no parameter-level detail. `reads`/`writes` edge kinds are
reserved and unused.

## Edge kinds

- **contains** — containment tree: module → declarations, class → members,
  function → nested functions. Forms a forest; cycles are invalid.
- **imports** — module → module. Merged per (from, to) with `count`;
  `typeOnly` only when *every* merged occurrence is type-only. Edges inside a
  module cycle (Tarjan SCC over value imports) carry `inCycle: true`.
- **calls** — caller (function/method/module for top-level calls) → callee.
  Resolved through the type checker with alias unwrapping, so calls through
  barrels land on the implementation. `new X()` targets the class node.
  Merged per (from, to) with `count`; `span` is the first site.
- **extends / implements** — heritage edges between internal declarations.

### Call-graph precision (normative for v1)

- Resolved internal callees → plain `calls` edge.
- Unresolved **identifier** callees (dynamic patterns, missing declarations)
  → edge to the shared sink `function:unresolved#<name>` with
  `confidence: "low"` — visible, never silently dropped.
- Unresolved **property** callees are omitted. The adapter analyzes with
  `noLib`, so built-ins (`console.log`, `Array.prototype.*`) fall in this
  bucket by design.
- A function referenced (not called) as a call argument gets a
  `confidence: "low"` edge from the caller — callbacks almost always get
  called, and diagrams that hide event handlers lie.

## Diagnostics

Parse errors, unresolvable imports and similar conditions surface as
`Diagnostic` entries in `AnalysisResult`, never as graph mutations and never
as thrown errors. A broken file yields a partial graph plus diagnostics.

## Validation

`validateGraph` is the machine check every golden fixture runs through:
unique ids, edge endpoints exist, canonical ordering, sane spans, id/kind
consistency, acyclic containment. Exporters may assume a valid graph.
