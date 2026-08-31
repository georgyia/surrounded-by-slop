import { analyzeTypeScriptProject } from "@surrounded-by-slop/core";
import { describe, expect, it } from "vitest";
import { renderMap } from "./render.js";
import { estimateTokens } from "./tokens.js";

/** A small app with a clear hub (`money`, used everywhere) and a leaf (`main`). */
const { graph } = analyzeTypeScriptProject([
  {
    path: "src/index.ts",
    text: [
      'import { charge } from "./payments";',
      'import { money } from "./money";',
      "export function main(): void {",
      "  charge(money(10));",
      "}",
    ].join("\n"),
  },
  {
    path: "src/payments.ts",
    text: [
      'import { money, add } from "./money";',
      "export function charge(amount: number): number {",
      "  return add(money(amount), money(1));",
      "}",
    ].join("\n"),
  },
  {
    path: "src/money.ts",
    text: [
      "export function money(n: number): number { return n; }",
      "export function add(a: number, b: number): number { return a + b; }",
    ].join("\n"),
  },
]);

describe("renderMap", () => {
  it("is deterministic — byte-identical across runs", () => {
    expect(renderMap(graph).text).toBe(renderMap(graph).text);
  });

  it("carries no timestamp or absolute path (diffable)", () => {
    const { text } = renderMap(graph);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/); // no ISO date
    expect(text).not.toMatch(/\/Users\/|\/home\/|[A-Z]:\\/); // no absolute path
  });

  it("fits within the token budget", () => {
    for (const budget of [80, 200, 2000]) {
      const { text } = renderMap(graph, { budget });
      // The map may exceed budget only when a single symbol already does.
      const { shownSymbols } = renderMap(graph, { budget });
      if (shownSymbols > 1) {
        expect(estimateTokens(text)).toBeLessThanOrEqual(budget);
      }
    }
  });

  it("shows fewer or equal symbols as the budget shrinks (monotonic)", () => {
    const big = renderMap(graph, { budget: 2000 }).shownSymbols;
    const small = renderMap(graph, { budget: 120 }).shownSymbols;
    expect(small).toBeLessThanOrEqual(big);
  });

  it("never renders an empty map, even on a tiny budget", () => {
    const { shownSymbols, text } = renderMap(graph, { budget: 1 });
    expect(shownSymbols).toBe(1);
    expect(text).toContain("money"); // the highest-ranked symbol
  });

  it("ranks the shared hub above the leaf (blind-test: 'what is central here?')", () => {
    const { text } = renderMap(graph, { budget: 2000 });
    expect(text.indexOf("money(")).toBeLessThan(text.indexOf("main("));
  });

  it("answers 'where is X defined?' by grouping symbols under their file", () => {
    const { text } = renderMap(graph, { budget: 2000 });
    const moneyBlock = text.slice(text.indexOf("src/money.ts:"));
    expect(moneyBlock).toContain("fn money");
    expect(moneyBlock).toContain("fn add");
  });

  it("reports accurate shown/total counts in the header", () => {
    const { text, shownSymbols, totalSymbols } = renderMap(graph, { budget: 2000 });
    expect(text).toContain(`${shownSymbols}/${totalSymbols} symbols`);
    expect(totalSymbols).toBe(4); // money, add, charge, main — no external sinks
  });

  it("shows an inbound count for referenced symbols", () => {
    const { text } = renderMap(graph, { budget: 2000 });
    expect(text).toMatch(/fn money\(n: number\): number ·\d+ ←\d+/);
  });
});

describe("the map leads with what a reader can reach (#153)", () => {
  const analyze = (text: string) => analyzeTypeScriptProject([{ path: "a.ts", text }]).graph;

  it("puts exported symbols ahead of local closures", () => {
    // A closure called by its parent scores well on PageRank — correctly, it is
    // locally important — but nothing outside the parent can call it, so it is
    // not what "what is this repo?" is asking about.
    const graph = analyze(
      [
        "export function api(): number {",
        "  function helper(): number { return 1; }",
        "  return helper() + helper() + helper();",
        "}",
      ].join("\n"),
    );
    const lines = renderMap(graph)
      .text.split("\n")
      .filter((line) => line.startsWith("  "));
    expect(lines[0]).toContain("api");
    expect(lines[1]).toContain("helper");
  });

  it("puts exported symbols ahead of non-exported top-level ones", () => {
    const graph = analyze(
      ["function internal(): void {}", "export function published(): void { internal(); }"].join(
        "\n",
      ),
    );
    const lines = renderMap(graph)
      .text.split("\n")
      .filter((line) => line.startsWith("  "));
    expect(lines[0]).toContain("published");
    expect(lines[1]).toContain("internal");
  });

  it("still lists closures — they rank last, they do not vanish", () => {
    const graph = analyze(
      [
        "export function outer(): number {",
        "  function inner(): number { return 1; }",
        "  return inner();",
        "}",
      ].join("\n"),
    );
    const rendered = renderMap(graph);
    expect(rendered.shownSymbols).toBe(2);
    expect(rendered.text).toContain("inner");
  });

  it("orders files by their most reachable member", () => {
    const graph = analyzeTypeScriptProject([
      {
        path: "closures.ts",
        text: "function host(): number {\n  function deep(): number { return 1; }\n  return deep() + deep();\n}\n",
      },
      { path: "api.ts", text: "export function surface(): void {}\n" },
    ]).graph;
    const text = renderMap(graph).text;
    expect(text.indexOf("api.ts:")).toBeLessThan(text.indexOf("closures.ts:"));
  });

  it("is deterministic", () => {
    const graph = analyze(
      [
        "export function a(): void {}",
        "export function b(): void {}",
        "function c(): void {}",
      ].join("\n"),
    );
    expect(renderMap(graph).text).toBe(renderMap(graph).text);
  });
});
