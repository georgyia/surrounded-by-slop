import type { EdgeKind, GraphEdge, NodeKind } from "@surrounded-by-slop/core";
import { describe, expect, it } from "vitest";
import { edgeLegend, nodeLegend } from "./legend.js";
import { paletteFor } from "./render.js";

const light = paletteFor("light");

function edge(kind: EdgeKind, extra: Partial<GraphEdge> = {}): GraphEdge {
  return { id: `${kind}:a->b`, kind, from: "a", to: "b", ...extra };
}

/** Every style at once — the "advertises everything" case the filter narrows. */
const allStyles: GraphEdge[] = [
  edge("calls"),
  edge("imports"),
  edge("extends"),
  edge("imports", { inCycle: true }),
  edge("imports", { typeOnly: true }),
  edge("calls", { count: 9 }),
];

const labels = (edges: GraphEdge[]): string[] =>
  edgeLegend(edges, light).map((entry) => entry.label);

describe("nodeLegend", () => {
  it("lists only the kinds present, in a stable order", () => {
    const kinds: NodeKind[] = ["function", "class", "module"];
    const entries = nodeLegend(kinds, light);
    expect(entries.map((entry) => entry.label)).toEqual(["Module", "Class", "Function"]);
  });

  it("uses the same fill the renderer draws for that kind", () => {
    const [fn] = nodeLegend(["function"], light);
    expect(fn?.fill).toBe(light.kinds.function.fill);
    expect(fn?.stroke).toBe(light.kinds.function.stroke);
  });

  it("dedupes and drops absent kinds", () => {
    expect(nodeLegend(["class", "class"], light).map((entry) => entry.label)).toEqual(["Class"]);
    expect(nodeLegend([], light)).toEqual([]);
  });
});

describe("edgeLegend", () => {
  it("explains every line style, dashing imports and de-emphasized edges", () => {
    const entries = edgeLegend(allStyles, light);
    expect(entries.map((entry) => entry.label)).toEqual([
      "calls",
      "imports",
      "extends / implements",
      "in an import cycle",
      "type-only / inferred",
      "thicker = used more often",
    ]);
    const byLabel = new Map(entries.map((entry) => [entry.label, entry]));
    expect(byLabel.get("imports")?.dashed).toBe(true);
    expect(byLabel.get("calls")?.dashed).toBeUndefined();
    expect(byLabel.get("extends / implements")?.stroke).toBe(light.heritage);
    expect(byLabel.get("in an import cycle")?.stroke).toBe(light.cycle);
  });

  it("demonstrates weight with a thick swatch, since thickness is its own channel", () => {
    const weighted = edgeLegend(allStyles, light).find((entry) => entry.weight !== undefined);
    expect(weighted?.label).toBe("thicker = used more often");
    expect(weighted?.weight).toBeGreaterThan(2);
  });

  it("omits the styles the diagram does not contain", () => {
    expect(labels([edge("calls"), edge("imports")])).toEqual(["calls", "imports"]);
    expect(labels([edge("calls")])).toEqual(["calls"]);
    expect(labels([])).toEqual([]);
  });

  it("shows the cycle and type-only entries only once such an edge exists", () => {
    expect(labels([edge("imports")])).not.toContain("in an import cycle");
    expect(labels([edge("imports", { inCycle: true })])).toContain("in an import cycle");
    expect(labels([edge("calls")])).not.toContain("type-only / inferred");
    expect(labels([edge("imports", { typeOnly: true })])).toContain("type-only / inferred");
    expect(labels([edge("calls", { confidence: "low" })])).toContain("type-only / inferred");
  });

  it("explains thickness only when the diagram has edges of differing weight", () => {
    expect(labels([edge("calls"), edge("calls", { count: 1 })])).not.toContain(
      "thicker = used more often",
    );
    expect(labels([edge("calls"), edge("calls", { count: 12 })])).toContain(
      "thicker = used more often",
    );
  });

  it("counts a cycle edge as an import, since it is still drawn dashed", () => {
    expect(labels([edge("imports", { inCycle: true })])).toEqual(["imports", "in an import cycle"]);
  });
});
