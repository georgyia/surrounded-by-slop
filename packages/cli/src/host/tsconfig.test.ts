import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { analyzeProject } from "./analyze.js";
import { discoverAliasOptions } from "./tsconfig.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sbs-tsconfig-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const write = (rel: string, text: string): void => {
  const full = join(root, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, text);
};

describe("discoverAliasOptions", () => {
  it("extracts path aliases anchored to the workspace", () => {
    write(
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } } }),
    );
    const discovery = discoverAliasOptions(root);
    expect(discovery.options?.paths).toEqual({ "@/*": ["src/*"] });
  });

  it("reports a reason when there is no tsconfig", () => {
    const discovery = discoverAliasOptions(root);
    expect(discovery.options).toBeUndefined();
    expect(discovery.reason).toContain("no tsconfig.json");
  });

  it("reports a reason when the tsconfig declares no aliases", () => {
    write("tsconfig.json", JSON.stringify({ compilerOptions: { strict: true } }));
    const discovery = discoverAliasOptions(root);
    expect(discovery.options).toBeUndefined();
    expect(discovery.reason).toContain("no path aliases");
  });
});

describe("analyzeProject with path aliases (#68 regression)", () => {
  it("resolves an aliased import to the internal module, not a fake external", () => {
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
    // The alias must not have produced a phantom external package node.
    expect(graph.nodes.some((node) => node.external === true && node.name.includes("@/"))).toBe(
      false,
    );
  });
});
