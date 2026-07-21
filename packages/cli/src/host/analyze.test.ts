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
  it("resolves a tsconfig alias to the internal module", () => {
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

    const { graph } = analyzeProject(root);
    const mathModule = graph.nodes.find((node) => node.id === "module:src/util/math.ts");
    expect(mathModule).toBeDefined();
    expect(mathModule?.external).not.toBe(true);
    expect(graph.nodes.some((node) => node.external === true && node.name.includes("@/"))).toBe(
      false,
    );
  });
});
