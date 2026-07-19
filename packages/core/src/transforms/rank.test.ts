import { describe, expect, it } from "vitest";
import { buildGraph, canonicalizeGraph } from "../ir/ids.js";
import type { GraphEdge, GraphNode, SemanticGraph } from "../ir/types.js";
import { SCHEMA_VERSION } from "../ir/types.js";
import { stableStringify } from "../stable-json.js";
import { analyzeTypeScriptProject } from "../typescript/adapter.js";
import { rankNodes } from "./rank.js";

/** A hand-built module graph: `a` and `b` both import `hub`; `a` also imports `b`. */
function importGraph(): SemanticGraph {
  const mod = (path: string): GraphNode => ({
    id: `module:${path}`,
    kind: "module",
    name: path,
    qualifiedName: path,
  });
  const imp = (from: string, to: string, extra: Partial<GraphEdge> = {}): GraphEdge => ({
    id: `imports:module:${from}->module:${to}`,
    kind: "imports",
    from: `module:${from}`,
    to: `module:${to}`,
    ...extra,
  });
  return buildGraph(
    [mod("a.ts"), mod("b.ts"), mod("hub.ts")],
    [imp("a.ts", "hub.ts"), imp("b.ts", "hub.ts"), imp("a.ts", "b.ts")],
  );
}

describe("rankNodes", () => {
  it("returns an empty ranking for an empty graph", () => {
    const empty = canonicalizeGraph({ schemaVersion: SCHEMA_VERSION, nodes: [], edges: [] });
    expect(rankNodes(empty)).toEqual([]);
  });

  it("scores are finite, non-negative and sum to ≈ 1", () => {
    const ranked = rankNodes(importGraph());
    expect(ranked).toHaveLength(3);
    for (const { score } of ranked) {
      expect(Number.isFinite(score)).toBe(true);
      expect(score).toBeGreaterThanOrEqual(0);
    }
    const total = ranked.reduce((sum, node) => sum + node.score, 0);
    expect(total).toBeCloseTo(1, 9);
  });

  it("ranks the most-imported node highest", () => {
    const ranked = rankNodes(importGraph());
    expect(ranked.at(0)?.id).toBe("module:hub.ts");
  });

  it("is deterministic regardless of input node/edge order", () => {
    const graph = importGraph();
    const shuffled = canonicalizeGraph({
      schemaVersion: graph.schemaVersion,
      nodes: [...graph.nodes].reverse(),
      edges: [...graph.edges].reverse(),
    });
    expect(stableStringify(rankNodes(shuffled))).toBe(stableStringify(rankNodes(graph)));
  });

  it("discounts low-confidence call edges below confident ones", () => {
    // Two identical sinks; `strong` is called confidently, `weak` heuristically.
    const nodes: GraphNode[] = [
      { id: "function:m.ts#caller", kind: "function", name: "caller", qualifiedName: "caller" },
      { id: "function:m.ts#strong", kind: "function", name: "strong", qualifiedName: "strong" },
      { id: "function:m.ts#weak", kind: "function", name: "weak", qualifiedName: "weak" },
    ];
    const edges: GraphEdge[] = [
      {
        id: "calls:function:m.ts#caller->function:m.ts#strong",
        kind: "calls",
        from: "function:m.ts#caller",
        to: "function:m.ts#strong",
      },
      {
        id: "calls:function:m.ts#caller->function:m.ts#weak",
        kind: "calls",
        from: "function:m.ts#caller",
        to: "function:m.ts#weak",
        confidence: "low",
      },
    ];
    const ranked = rankNodes(buildGraph(nodes, edges));
    const strong = ranked.find((r) => r.id === "function:m.ts#strong");
    const weak = ranked.find((r) => r.id === "function:m.ts#weak");
    expect(strong?.score).toBeGreaterThan(weak?.score ?? 0);
  });

  it("personalization lifts a seeded node's neighborhood", () => {
    const graph = importGraph();
    const globalRank = rankNodes(graph);
    const seeded = rankNodes(graph, { seeds: ["module:a.ts"] });
    const rankOf = (list: ReturnType<typeof rankNodes>, id: string) =>
      list.findIndex((node) => node.id === id);
    // `a.ts` is a source in the import graph (no inbound edges) so it sits last
    // globally; seeding it must raise its standing.
    expect(rankOf(seeded, "module:a.ts")).toBeLessThan(rankOf(globalRank, "module:a.ts"));
  });

  it("ignores seeds that are not in the graph (falls back to uniform)", () => {
    const graph = importGraph();
    const bogus = rankNodes(graph, { seeds: ["module:does-not-exist.ts"] });
    expect(stableStringify(bogus)).toBe(stableStringify(rankNodes(graph)));
  });

  it("ranks core's own load-bearing modules above leaves (dogfood)", () => {
    const { graph } = analyzeTypeScriptProject([
      {
        path: "src/app.ts",
        text: [
          'import { save } from "./store/db";',
          "export function main(): void {",
          "  save();",
          "  save();",
          "}",
        ].join("\n"),
      },
      {
        path: "src/store/db.ts",
        text: "export function save(): void {}",
      },
      {
        path: "src/unused.ts",
        text: "export function orphan(): void {}",
      },
    ]);
    const ranked = rankNodes(graph);
    const rankOf = (id: string) => ranked.findIndex((node) => node.id === id);
    // `save`, called twice from main, must outrank the never-referenced orphan.
    expect(rankOf("function:src/store/db.ts#save")).toBeLessThan(
      rankOf("function:src/unused.ts#orphan"),
    );
  });
});
