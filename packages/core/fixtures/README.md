# Fixtures

Golden-file test cases for the analysis pipeline. Each case is a directory:

```
fixtures/<case-name>/
  input.ts        # source code under analysis (any supported language)
  expected.json   # the Semantic Graph the analyzer must produce
```

Rules:

- `expected.json` is written with `stableStringify(graph, 2)` — deterministic,
  sorted keys, two-space indent. Never hand-edit formatting.
- Case names describe the language feature under test (`class-inheritance`,
  `dynamic-import`), not the bug that motivated them.
- A fixture must be minimal: the smallest input that exercises the behavior.

The analyzer that consumes these arrives with the Semantic Graph IR; the
conventions are fixed now so every fixture written since day one stays valid.
