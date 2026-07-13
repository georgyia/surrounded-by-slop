import {
  buildGraph,
  type ControlFlowGraph,
  cfgBlockLabel,
  edgeId,
  extractControlFlow,
  type GraphEdge,
  type GraphNode,
  layoutGraph,
} from "@surrounded-by-slop/core";
import { describe, expect, it } from "vitest";
import { renderFlowDiagram } from "./flowRender.js";

/** Mirror of the host-side synthetic graph: one node per block, calls edges. */
async function layoutFor(cfg: ControlFlowGraph) {
  const nodes: GraphNode[] = cfg.blocks.map((block) => ({
    id: block.id,
    kind: "variable", // plain displayLabel — no () decoration on block text
    name: cfgBlockLabel(block),
    qualifiedName: block.id,
  }));
  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const edge of cfg.edges) {
    const id = edgeId("calls", edge.from, edge.to);
    if (!seen.has(id) && edge.from !== edge.to) {
      seen.add(id);
      edges.push({ id, kind: "calls", from: edge.from, to: edge.to });
    }
  }
  return layoutGraph(buildGraph(nodes, edges), { direction: "DOWN" });
}

function cfgOf(source: string): ControlFlowGraph {
  const cfg = extractControlFlow({ path: "f.ts", text: source }).cfgs[0];
  if (cfg === undefined) {
    throw new Error("no cfg");
  }
  return cfg;
}

describe("renderFlowDiagram", () => {
  it("draws Start/End pills, condition labels, and clickable blocks", async () => {
    const cfg = cfgOf(
      "function f(n: number) {\n  if (n > 0) {\n    return n;\n  }\n  return 0;\n}\n",
    );
    const svg = renderFlowDiagram(cfg, await layoutFor(cfg), "light");
    expect(svg).toContain(">Start</text>");
    expect(svg).toContain(">End</text>");
    expect(svg).toContain(">true</text>");
    expect(svg).toContain(">false</text>");
    for (const block of cfg.blocks) {
      expect(svg).toContain(`data-node-id="${block.id}"`);
    }
    expect(svg).toContain('class="slop-viewport"');
  });

  it("styles loop back edges dashed and distinct from normal flow", async () => {
    const cfg = cfgOf("function f(n: number) {\n  while (n > 0) {\n    n -= 1;\n  }\n}\n");
    const svg = renderFlowDiagram(cfg, await layoutFor(cfg), "light");
    expect(svg).toContain('data-flow-kind="back"');
    const backLine = svg.split("\n").find((line) => line.includes('data-flow-kind="back"'));
    expect(backLine).toContain("stroke-dasharray");
    expect(backLine).toContain("#8250df"); // heritage purple, not the normal edge gray
  });

  it("merges parallel branch edges into one labeled line", async () => {
    // if with no else and an empty-ish arm: true and false converge on one target.
    const cfg = cfgOf("function f(n: number) {\n  if (n > 0) {\n    n = 0;\n  }\n  return n;\n}\n");
    const svg = renderFlowDiagram(cfg, await layoutFor(cfg), "light");
    // No duplicated polyline for the same pair: count lines vs distinct pairs.
    const pairs = new Set(cfg.edges.map((edge) => `${edge.from}->${edge.to}`));
    const polylines = svg.match(/<polyline/g) ?? [];
    expect(polylines.length).toBe(pairs.size);
  });

  it("dims code after a return and badges it as unreachable", async () => {
    const cfg = cfgOf('function f() {\n  return 1;\n  console.log("never");\n}\n');
    const svg = renderFlowDiagram(cfg, await layoutFor(cfg), "light");
    expect(svg).toContain("slop-unreachable");
    expect(svg).toContain(">unreachable</text>");
    const deadLine = svg.split("\n").find((line) => line.includes("slop-unreachable"));
    expect(deadLine).toContain('opacity="0.45"');
    expect(deadLine).toContain("(unreachable code)"); // announced to screen readers
  });

  it("never badges reachable code (no false positives)", async () => {
    const cfg = cfgOf(
      "function f(n: number) {\n  if (n > 0) {\n    return n;\n  }\n  for (let i = 0; i < n; i++) {\n    n += i;\n  }\n  return n;\n}\n",
    );
    const svg = renderFlowDiagram(cfg, await layoutFor(cfg), "light");
    expect(svg).not.toContain("slop-unreachable");
    expect(svg).not.toContain(">unreachable</text>");
  });

  it("escapes hostile statement text", async () => {
    const cfg = cfgOf('function f() {\n  const s = "<img>";\n  return s;\n}\n');
    const svg = renderFlowDiagram(cfg, await layoutFor(cfg), "light");
    expect(svg).not.toContain("<img>");
    expect(svg).toContain("&lt;img&gt;");
  });
});
