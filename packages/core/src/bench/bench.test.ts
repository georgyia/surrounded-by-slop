import { describe, expect, it } from "vitest";
import { analyzeTypeScriptProject } from "../typescript/adapter.js";
import { compareBench, formatComparison } from "./compare.js";
import { syntheticProject } from "./synthetic.js";

describe("syntheticProject", () => {
  it("is deterministic and analyzable", () => {
    const first = syntheticProject(10);
    const second = syntheticProject(10);
    expect(second).toEqual(first);
    expect(first.length).toBe(12); // 10 modules + 2 hubs

    const { graph, diagnostics } = analyzeTypeScriptProject(first);
    expect(diagnostics).toEqual([]);
    // Every module analyzed, imports resolved into edges.
    const modules = graph.nodes.filter((node) => node.kind === "module" && node.external !== true);
    expect(modules.length).toBe(12);
    expect(graph.edges.some((edge) => edge.kind === "imports")).toBe(true);
    expect(graph.edges.some((edge) => edge.kind === "calls")).toBe(true);
  });
});

describe("compareBench — the regression gate CI relies on", () => {
  const budgets = { "large.analyzeMs": 1000 };

  it("passes when within budget and tolerance", () => {
    const comparison = compareBench(
      { metrics: { "large.analyzeMs": 500 } },
      { metrics: { "large.analyzeMs": 480 } },
      budgets,
    );
    expect(comparison.failures).toEqual([]);
    expect(comparison.rows[0]?.status).toBe("ok");
  });

  it("catches an intentionally slowed build (> 20% over baseline)", () => {
    const comparison = compareBench(
      { metrics: { "large.analyzeMs": 700 } }, // ~46% slower than baseline
      { metrics: { "large.analyzeMs": 480 } },
      budgets,
    );
    expect(comparison.failures.length).toBe(1);
    expect(comparison.rows[0]?.status).toBe("regression");
    expect(comparison.failures[0]).toContain("over the baseline");
  });

  it("fails on an absolute budget breach even without a baseline", () => {
    const comparison = compareBench({ metrics: { "large.analyzeMs": 1200 } }, undefined, budgets);
    expect(comparison.rows[0]?.status).toBe("over-budget");
    expect(comparison.failures[0]).toContain("exceeds its budget");
  });

  it("respects a custom tolerance", () => {
    const comparison = compareBench(
      { metrics: { "large.analyzeMs": 540 } }, // 12.5% slower
      { metrics: { "large.analyzeMs": 480 } },
      budgets,
      10,
    );
    expect(comparison.rows[0]?.status).toBe("regression");
  });

  it("formats an aligned comparison table", () => {
    const comparison = compareBench(
      { metrics: { "large.analyzeMs": 500, "large.heapMB": 90 } },
      { metrics: { "large.analyzeMs": 480 } },
      budgets,
    );
    const table = formatComparison(comparison);
    expect(table).toContain("metric");
    expect(table).toContain("large.analyzeMs");
    expect(table.split("\n").length).toBe(3);
  });
});
