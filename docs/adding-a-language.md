# Adding a language

Slop analyzes TypeScript/JavaScript with the compiler API, and every other
language through **tree-sitter**. Thanks to the query-file convention
(SBS-080), a new language is mostly three queries and a module resolver — not
a new analyzer. This guide walks the whole path using **Python** (the first
tree-sitter language, `packages/core/src/python/`) as the worked example.

Budget expectation: a first working adapter is an afternoon of work; the
fixtures are most of it.

## How the pieces fit

```
grammar wasm ──▶ loadTreeSitterLanguage() ──▶ LoadedLanguage
                                                 │
your three queries + module resolver ──▶ analyzeWithTreeSitter() ──▶ SemanticGraph
```

- `loadTreeSitterLanguage(runtimeWasm, grammarWasm)` (core) initializes the
  shared WASM runtime once and loads your grammar. Everything after that is
  synchronous, like every adapter.
- `analyzeWithTreeSitter({ files, language, queries, resolveModule })` turns
  query captures into IR nodes and edges. You never build graph nodes by hand.

## Step 1 — get a grammar wasm

We source grammars from [`@vscode/tree-sitter-wasm`](https://www.npmjs.com/package/@vscode/tree-sitter-wasm)
(prebuilt, ABI-matched to our `web-tree-sitter`). Check
`node_modules/@vscode/tree-sitter-wasm/wasm/` first — bash, c-sharp, cpp, css,
go, ini, java, javascript, php, powershell, python, regex, ruby, rust, and
typescript are already there.

If your language isn't included, build the wasm yourself with
`tree-sitter build --wasm` from the grammar repo, and note in your PR where it
came from and its license. The wasm must load against `web-tree-sitter` 0.26.

## Step 2 — write the three queries

Create `packages/core/src/<language>/adapter.ts`. The queries are ordinary
[tree-sitter queries](https://tree-sitter.github.io/tree-sitter/using-parsers#query-syntax);
the **capture names are the contract** (see `treesitter/mapper.ts`):

| Query       | Captures you must produce                            |
|-------------|-------------------------------------------------------|
| `structure` | `@class.def` + `@class.name`, `@function.def` + `@function.name` per match |
| `imports`   | `@import.module` on the node holding the module path  |
| `calls`     | `@call.name` on the callee's name node                |

The mapper derives the rest:

- **Containment** comes from span nesting — a `@function.def` inside a
  `@class.def` becomes a `method` automatically. Your queries stay flat.
- **Imports** run through your `resolveModule(fromFile, moduleText)`; return a
  project file path, or `undefined` to materialize an external module node.
- **Calls** resolve heuristically to same-module declarations by name and are
  marked `confidence: "low"`. That's deliberate: without a type checker,
  honesty beats guessing. Declare it: `callGraph: "heuristic"`.

The entire Python mapping is ~30 lines of queries — read
`pythonQueries` in `packages/core/src/python/adapter.ts` next to a
[Python grammar playground](https://tree-sitter.github.io/tree-sitter/playground)
and you'll see the pattern immediately.

## Step 3 — the adapter factory

Follow `createPythonAdapter` exactly:

```ts
export async function createGoAdapter(wasm: GoWasm): Promise<LanguageAdapter> {
  const language = await loadTreeSitterLanguage(wasm.runtime, wasm.go);
  return {
    id: "go",
    displayName: "Go",
    extensions: [".go"],
    capabilities: { imports: true, callGraph: "heuristic", cfg: false, dataflow: false },
    analyze(files, options) {
      const paths = new Set(files.map((file) => file.path));
      return analyzeWithTreeSitter({
        files: [...files],
        language,
        queries: goQueries,
        resolveModule: (from, text) => resolveGoModule(paths, from, text),
        cancellation: options?.cancellation,
      });
    },
  };
}
```

Rules that reviews will hold you to:

- **Core stays pure.** No filesystem in the adapter — wasm bytes come in as
  arguments. Only tests and the extension read files.
- **Capability flags are honest.** `callGraph: "heuristic"`, `cfg: false`,
  `dataflow: false` unless you genuinely implemented more.
- **Document your limits** in the adapter header, like Python does (no
  cross-module calls, no dynamic imports, …).

## Step 4 — fixtures (this is the actual work)

Create `packages/core/fixtures/<language>/<case>/input.<ext>` (or `project/`
for multi-file cases) and a harness `src/<language>/fixtures.test.ts` copied
from `src/python/fixtures.test.ts`. Add your category to `FOREIGN_CATEGORIES`
in `src/typescript/fixtures.test.ts`.

Aim for ≥ 15 cases: plain functions, classes/methods, nesting, decorators or
your language's equivalent, each import form your resolver handles, external
imports, recursive calls, and one multi-file mini-app proving imports resolve
across packages. Generate goldens with `UPDATE_FIXTURES=1 pnpm test` and
**review them like code** — the golden files are the spec.

## Step 5 — wire the hosts

A language has to be registered in **both** hosts, or it works in one and
silently does nothing in the other — which is exactly what happened before
[#131](https://github.com/georgyia/surrounded-by-slop/issues/131). Two of these
steps are guarded by tests; the rest are a checklist.

**The editor** (`packages/extension`):

1. `esbuild.mjs` — add your wasm to the grammar copy list, so it ships in the VSIX.
2. `.vscodeignore` — already ships `dist/*.wasm`; nothing to do.
3. `src/controller.ts` — add a row to `TREE_SITTER_LANGUAGES` (language id,
   file extension, wasm name, factory) and your VS Code language id to
   `LANGUAGE_EXTENSIONS`. There is no per-language code to write: discovery,
   analysis and the single-file path all read the table.
4. `package.json` — add your extension to the `slop.include` default glob, and
   your language id to the `when` clauses of the Visualize File menu and
   keybinding. **Guarded:** a manifest test compares that glob against
   `DEFAULT_INCLUDE` and fails naming the missing extension.
5. An integration test like "Visualize File charts a Python file…" in
   `src/test/suite/workspace.test.ts`, plus a fixture in
   `test-fixtures/workspace/`.

**The CLI, MCP server and scripts** (`packages/host`):

6. `src/grammars.ts` — add a `GRAMMARS` entry (extensions, wasm filename,
   factory). Everything downstream — `sbs map`, `query`, `impact`, the MCP
   tools — picks it up, loading the grammar only when a project contains that
   language.
7. `src/decisions.ts` — add your extension to `DEFAULT_INCLUDE`, or the files
   are never discovered in the first place. **Guarded** by the same manifest test.

**Everyone:**

8. `docs/user-guide.md` — add a row to the language-limits table and a short
   paragraph on what your analyzer cannot see. `docs/agent-interface.md`
   regenerates its own table from the adapter's capability flags, so
   `pnpm docs:agent` is all that page needs.

## PR checklist

- [ ] Adapter in `packages/core/src/<language>/` with honest capabilities and documented limits
- [ ] ≥ 15 golden fixtures, reviewed, incl. one multi-file project
- [ ] Grammar wasm source + license noted in the PR description
- [ ] Extension wiring (`TREE_SITTER_LANGUAGES`, esbuild, manifest) + one integration test
- [ ] Host wiring (`grammars.ts`, `DEFAULT_INCLUDE`) so the CLI and MCP server see it too
- [ ] `sbs map` on a file of your language lists its symbols
- [ ] `pnpm lint && pnpm typecheck && pnpm test` green, DCO sign-off on every commit
- [ ] `docs/adding-a-language.md` updated if you hit anything this guide missed

Open a [language request](https://github.com/georgyia/surrounded-by-slop/issues/new?template=language_request.yml)
first if you want a maintainer to reserve the language and answer questions
while you build. Look for open [`lang:*` issues](https://github.com/georgyia/surrounded-by-slop/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)
— those are languages we've already scoped as good first contributions.
