import { analyzeTypeScriptProject } from "@surrounded-by-slop/core";
import { describe, expect, it } from "vitest";
import type { ChangedLines } from "./diff.js";
import { computeImpact } from "./impact.js";

// place() → discount() ; main() → place() ; a test calls place().
const { graph } = analyzeTypeScriptProject([
  {
    path: "src/orders.ts",
    text: [
      "export function discount(n: number): number {", // line 1
      "  return n * 0.9;", // line 2
      "}", // 3
      "export function place(n: number): number {", // 4
      "  return discount(n);", // 5
      "}", // 6
    ].join("\n"),
  },
  {
    path: "src/app.ts",
    text: [
      'import { place } from "./orders";',
      "export function main(): number {",
      "  return place(1);",
      "}",
    ].join("\n"),
  },
  {
    path: "src/orders.test.ts",
    text: ['import { place } from "./orders";', "export const t = place(2);"].join("\n"),
  },
]);

const changed = (file: string, ...lineNums: number[]): ChangedLines =>
  new Map([[file, new Set(lineNums)]]);

describe("computeImpact", () => {
  it("maps a changed line to its enclosing symbol", () => {
    const result = computeImpact(graph, changed("src/orders.ts", 2), { depth: 1 });
    expect(result.changed.map((n) => n.name)).toEqual(["discount"]);
  });

  it("finds direct callers at depth 1", () => {
    const result = computeImpact(graph, changed("src/orders.ts", 2), { depth: 1 });
    // discount is called by place.
    expect(result.reached.some((n) => n.name === "place")).toBe(true);
    // main is two hops away — not at depth 1.
    expect(result.reached.some((n) => n.name === "main")).toBe(false);
  });

  it("reaches further at depth 2", () => {
    const result = computeImpact(graph, changed("src/orders.ts", 2), { depth: 2 });
    expect(result.reached.some((n) => n.name === "main")).toBe(true);
  });

  it("flags affected test files", () => {
    const result = computeImpact(graph, changed("src/orders.ts", 5), { depth: 2 });
    // place is changed; the test imports and calls place.
    expect(result.tests).toContain("src/orders.test.ts");
  });

  it("reports a changed symbol with no callers as itself only", () => {
    // main() is called by nobody.
    const result = computeImpact(graph, changed("src/app.ts", 3), { depth: 2 });
    expect(result.changed.map((n) => n.name)).toEqual(["main"]);
    expect(result.reached).toEqual([]);
  });

  it("returns an empty result when the change touches no symbol", () => {
    const result = computeImpact(graph, changed("src/nonexistent.ts", 1), { depth: 2 });
    expect(result.changed).toEqual([]);
    expect(result.reached).toEqual([]);
    expect(result.subgraph.nodes).toEqual([]);
  });

  it("emits a valid subgraph of changed ∪ reached", () => {
    const result = computeImpact(graph, changed("src/orders.ts", 2), { depth: 2 });
    const ids = new Set(result.subgraph.nodes.map((n) => n.id));
    // Every edge endpoint is present — a well-formed subgraph.
    for (const edge of result.subgraph.edges) {
      expect(ids.has(edge.from) && ids.has(edge.to)).toBe(true);
    }
  });
});
