# Fixtures

Golden-file test cases for the analysis pipeline, grouped by the behavior
under test (`structure/`, `imports/`, `calls/`, `workspace/`). Each case is a
directory:

```
fixtures/<category>/<case-name>/
  input.ts          # single-file case (input.tsx / input.js / input.jsx work too)
  project/          # OR a multi-file case: the directory tree is the project
  options.json      # optional adapter options, e.g. { "compilerOptions": { … } }
  expected.json     # golden AnalysisResult (graph + diagnostics)
```

Rules:

- `expected.json` is generated, never hand-written:

  ```bash
  UPDATE_FIXTURES=1 pnpm test
  ```

  Review the diff like code — the golden files *are* the spec's test surface.
- Every case must pass `validateGraph` and a double-run determinism check;
  the harness (`src/typescript/fixtures.test.ts`) enforces both.
- Case names describe the language feature under test (`class-inheritance`,
  `dynamic-import`), not the bug that motivated them.
- A fixture must be minimal: the smallest input that exercises the behavior.
- Fixture inputs are excluded from Biome on purpose — reformatting them would
  shift source spans and invalidate every golden.
- Goldens embed checker-rendered signatures and parser messages, so a
  TypeScript compiler upgrade may legitimately regenerate them; review that
  diff, don't fight it.
