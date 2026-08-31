import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { analyzeProject } from "./analyze.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sbs-analyze-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(rel: string, text: string): void {
  const full = join(root, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, text);
}

describe("analyzeProject", () => {
  it("resolves a tsconfig alias to the internal module", async () => {
    write(
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } } }),
    );
    write("src/util/math.ts", "export function add(a: number, b: number) { return a + b; }");
    write(
      "src/main.ts",
      ['import { add } from "@/util/math";', "export function run() { return add(1, 2); }"].join(
        "\n",
      ),
    );

    const { graph } = await analyzeProject(root);
    const mathModule = graph.nodes.find((node) => node.id === "module:src/util/math.ts");
    expect(mathModule).toBeDefined();
    expect(mathModule?.external).not.toBe(true);
    expect(graph.nodes.some((node) => node.external === true && node.name.includes("@/"))).toBe(
      false,
    );
  });
});

describe("analyzeProject — every language the extension supports (#131)", () => {
  it("analyzes TypeScript, Python and Go from one project", async () => {
    // Before this, a mixed repo produced an empty map: the .py files went to
    // the TypeScript analyzer and the .go files were never discovered.
    write("src/app.ts", "export function tsRun(): number { return 1; }");
    write("app.py", "def py_helper():\n    return 1\n\n\ndef py_run():\n    return py_helper()\n");
    write(
      "main.go",
      "package main\n\nfunc goHelper() int { return 1 }\n\nfunc goRun() int { return goHelper() }\n",
    );

    const { graph } = await analyzeProject(root);
    const names = new Set(graph.nodes.map((node) => node.name));
    expect(names).toContain("tsRun");
    expect(names).toContain("py_run");
    expect(names).toContain("goRun");
  });

  it("keeps each language's call edges", async () => {
    write("app.py", "def helper():\n    return 1\n\n\ndef run():\n    return helper()\n");
    const { graph } = await analyzeProject(root);
    const call = graph.edges.find((edge) => edge.kind === "calls");
    expect(call).toBeDefined();
    // Tree-sitter resolution is by name, and says so.
    expect(call?.confidence).toBe("low");
  });

  it("produces one graph with no duplicate ids across languages", async () => {
    write("src/a.ts", "export function shared(): void {}");
    write("b.py", "def shared():\n    pass\n");
    write("c.go", "package main\n\nfunc shared() {}\n");

    const { graph } = await analyzeProject(root);
    const ids = graph.nodes.map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Same symbol name in three languages stays three distinct nodes, because
    // ids are path-based.
    expect(ids.filter((id) => id.endsWith("#shared"))).toHaveLength(3);
  });

  it("is deterministic regardless of which language is discovered first", async () => {
    write("a.py", "def one():\n    pass\n");
    write("z.go", "package main\n\nfunc two() {}\n");
    const first = await analyzeProject(root);
    const second = await analyzeProject(root);
    expect(second.graph).toEqual(first.graph);
  });
});
