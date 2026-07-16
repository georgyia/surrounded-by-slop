import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { type FileInput, OperationCancelledError } from "../adapter.js";
import { pythonQueries } from "../python/adapter.js";
import type { LanguageQueries } from "./mapper.js";
import { analyzeWithTreeSitter } from "./mapper.js";
import { type LoadedLanguage, loadTreeSitterLanguage } from "./runtime.js";

/**
 * Contract tests for the generic query→IR engine, independent of any one
 * language. The Python grammar is only a convenient host: what's under test is
 * how the mapper reacts to the query sets a new adapter might hand it
 * (docs/adding-a-language.md), including malformed ones.
 */

const require = createRequire(import.meta.url);

let language: LoadedLanguage;
beforeAll(async () => {
  language = await loadTreeSitterLanguage(
    fs.readFileSync(require.resolve("web-tree-sitter/web-tree-sitter.wasm")),
    fs.readFileSync(
      path.join(
        path.dirname(require.resolve("@vscode/tree-sitter-wasm/package.json")),
        "wasm/tree-sitter-python.wasm",
      ),
    ),
  );
});

const file = (path: string, text: string): FileInput => ({ path, text });

function analyze(
  files: readonly FileInput[],
  queries: LanguageQueries,
  resolveModule: (from: string, module: string) => string | undefined = () => undefined,
) {
  return analyzeWithTreeSitter({ files, language, queries, resolveModule });
}

const noQueries: LanguageQueries = { structure: "", imports: "", calls: "" };

describe("analyzeWithTreeSitter", () => {
  it("emits a module node per file even with no queries", () => {
    const result = analyze([file("a.py", "x = 1\n")], noQueries);
    expect(result.graph.nodes.map((node) => node.kind)).toEqual(["module"]);
    expect(result.graph.nodes[0]?.qualifiedName).toBe("a.py");
  });

  it("warns about a file with syntax errors instead of throwing", () => {
    const result = analyze([file("broken.py", "def (:\n")], pythonQueries);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ severity: "warning", file: "broken.py" }),
    );
  });

  it("honours cancellation", () => {
    expect(() =>
      analyzeWithTreeSitter({
        files: [file("a.py", "x = 1\n")],
        language,
        queries: noQueries,
        resolveModule: () => undefined,
        cancellation: { cancelled: true },
      }),
    ).toThrow(OperationCancelledError);
  });

  describe("structure queries", () => {
    it("derives method-ness and qualified names from span nesting", () => {
      const result = analyze(
        [file("a.py", "class Cart:\n    def add(self):\n        pass\n")],
        pythonQueries,
      );
      const method = result.graph.nodes.find((node) => node.kind === "method");
      expect(method?.qualifiedName).toBe("Cart.add");
    });

    it("skips matches missing a .def capture", () => {
      // A query that captures only the name — the engine has no span to anchor.
      const result = analyze([file("a.py", "class Cart:\n    pass\n")], {
        ...noQueries,
        structure: "(class_definition name: (identifier) @class.name)",
      });
      expect(result.graph.nodes.map((node) => node.kind)).toEqual(["module"]);
    });

    it("skips matches whose capture prefix is not class or function", () => {
      const result = analyze([file("a.py", "class Cart:\n    pass\n")], {
        ...noQueries,
        structure: "(class_definition name: (identifier) @thing.name) @thing.def",
      });
      expect(result.graph.nodes.map((node) => node.kind)).toEqual(["module"]);
    });
  });

  describe("import queries", () => {
    it("ignores captures other than @import.module", () => {
      const result = analyze([file("a.py", "import os\n")], {
        ...noQueries,
        imports: "(import_statement name: (dotted_name) @import.module) @import.stmt",
      });
      // The extra @import.stmt capture must not produce a second edge.
      expect(result.graph.edges.filter((edge) => edge.kind === "imports")).toHaveLength(1);
    });

    it("resolves project imports to the target module and leaves others external", () => {
      const files = [file("a.py", "import b\nimport os\n"), file("b.py", "x = 1\n")];
      const result = analyze(files, pythonQueries, (_from, module) =>
        module === "b" ? "b.py" : undefined,
      );
      const external = result.graph.nodes.find((node) => node.external === true);
      expect(external?.name).toBe("os");
      expect(result.graph.edges.filter((edge) => edge.kind === "imports")).toHaveLength(2);
    });

    it("drops a self-import rather than drawing a loop", () => {
      const result = analyze([file("a.py", "import a\n")], pythonQueries, () => "a.py");
      expect(result.graph.edges.filter((edge) => edge.kind === "imports")).toEqual([]);
    });
  });

  describe("call queries", () => {
    it("skips matches without a @call.name capture", () => {
      const result = analyze([file("a.py", "def go():\n    pass\ngo()\n")], {
        ...noQueries,
        structure: pythonQueries.structure,
        calls: "(call function: (identifier) @callee)",
      });
      expect(result.graph.edges.filter((edge) => edge.kind === "calls")).toEqual([]);
    });

    it("marks resolved same-module calls low-confidence", () => {
      const result = analyze([file("a.py", "def go():\n    pass\ndef run():\n    go()\n")], {
        ...noQueries,
        structure: pythonQueries.structure,
        calls: pythonQueries.calls,
      });
      const call = result.graph.edges.find((edge) => edge.kind === "calls");
      expect(call?.confidence).toBe("low");
    });

    it("stays quiet about calls it cannot resolve in-module", () => {
      const result = analyze([file("a.py", "print('hi')\n")], pythonQueries);
      expect(result.graph.edges.filter((edge) => edge.kind === "calls")).toEqual([]);
    });
  });
});
