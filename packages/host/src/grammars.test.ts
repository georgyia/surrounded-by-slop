import { describe, expect, it } from "vitest";
import { adaptersForPaths, isTypeScriptPath, TREE_SITTER_EXTENSIONS } from "./grammars.js";

describe("isTypeScriptPath", () => {
  it("routes TypeScript and JavaScript to the compiler, not a grammar", () => {
    for (const path of ["a.ts", "a.tsx", "a.mts", "a.cts", "a.js", "a.jsx", "a.mjs", "a.cjs"]) {
      expect(isTypeScriptPath(path)).toBe(true);
    }
  });

  it("routes every tree-sitter language away from the compiler", () => {
    for (const path of ["a.py", "a.go", "a.java", "a.rs", "a.rb", "a.cs"]) {
      expect(isTypeScriptPath(path)).toBe(false);
    }
  });

  it("is case-insensitive, because Windows checkouts are", () => {
    expect(isTypeScriptPath("A.PY")).toBe(false);
    expect(isTypeScriptPath("Main.GO")).toBe(false);
  });

  it("does not mistake a lookalike suffix for a language", () => {
    // `.gopher` is not Go; `.rsync` is not Rust.
    expect(isTypeScriptPath("notes.gopher")).toBe(true);
    expect(isTypeScriptPath("backup.rsync")).toBe(true);
  });
});

describe("TREE_SITTER_EXTENSIONS", () => {
  it("lists every non-TypeScript language the project supports", () => {
    expect([...TREE_SITTER_EXTENSIONS].sort()).toEqual(
      [".cs", ".go", ".java", ".py", ".rb", ".rs"].sort(),
    );
  });
});

describe("adaptersForPaths", () => {
  it("loads nothing for a TypeScript-only project", async () => {
    // The point of loading lazily: six grammars are ~9 MB of wasm, and a TS
    // repo must not pay for any of it.
    expect(await adaptersForPaths(["src/a.ts", "src/b.tsx"])).toEqual([]);
    expect(await adaptersForPaths([])).toEqual([]);
  });

  it("loads exactly the languages present", async () => {
    const adapters = await adaptersForPaths(["a.py", "b.ts", "c.py"]);
    expect(adapters.map((adapter) => adapter.id)).toEqual(["python"]);
  });

  it("loads several languages at once, in a stable order", async () => {
    const first = await adaptersForPaths(["a.go", "b.py"]);
    const second = await adaptersForPaths(["b.py", "a.go"]);
    // Declaration order, not discovery order — a merged graph must not depend
    // on which file the walker happened to see first.
    expect(first.map((adapter) => adapter.id)).toEqual(second.map((adapter) => adapter.id));
    expect(first.map((adapter) => adapter.id)).toEqual(["python", "go"]);
  });

  it("returns the same adapter instance on a second call", async () => {
    // A long-lived MCP session must parse each grammar once, not per request.
    const [first] = await adaptersForPaths(["a.rb"]);
    const [second] = await adaptersForPaths(["other.rb"]);
    expect(first).toBe(second);
  });

  it("produces adapters that actually parse their language", async () => {
    const [python] = await adaptersForPaths(["a.py"]);
    expect(python).toBeDefined();
    const result = python?.analyze([{ path: "a.py", text: "def go():\n    pass\n" }]);
    expect(result?.graph.nodes.some((node) => node.name === "go")).toBe(true);
  });
});
