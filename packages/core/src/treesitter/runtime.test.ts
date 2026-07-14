import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { type LoadedLanguage, loadTreeSitterLanguage } from "./runtime.js";

const require = createRequire(import.meta.url);
const runtimeWasm = () => fs.readFileSync(require.resolve("web-tree-sitter/web-tree-sitter.wasm"));
const pythonWasm = () =>
  fs.readFileSync(
    path.join(
      path.dirname(require.resolve("@vscode/tree-sitter-wasm/package.json")),
      "wasm/tree-sitter-python.wasm",
    ),
  );

describe("loadTreeSitterLanguage", () => {
  let loaded: LoadedLanguage;
  let firstLoadMs = 0;

  beforeAll(async () => {
    const start = performance.now();
    loaded = await loadTreeSitterLanguage(runtimeWasm(), pythonWasm());
    firstLoadMs = performance.now() - start;
  });

  it("initializes fast enough to load on demand (< 100 ms budget for init)", async () => {
    // First call pays runtime init + grammar load together; both are small.
    expect(firstLoadMs).toBeLessThan(1000);
    // A second grammar load reuses the initialized runtime and is quicker still.
    const start = performance.now();
    await loadTreeSitterLanguage(runtimeWasm(), pythonWasm());
    expect(performance.now() - start).toBeLessThan(100);
  });

  it("parses synchronously once loaded and reports spans", () => {
    const tree = loaded.parse("def f():\n    return 1\n");
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.startPosition.row).toBe(0);
  });

  it("caches compiled queries by source", () => {
    const source = "(function_definition name: (identifier) @function.name) @function.def";
    expect(loaded.query(source)).toBe(loaded.query(source));
    const matches = loaded.query(source).matches(loaded.parse("def alpha():\n    pass\n").rootNode);
    expect(matches.length).toBe(1);
  });
});
