import { describe, expect, it } from "vitest";
import { buildGraph, declarationId, edgeId, moduleId } from "../ir/ids.js";
import type { GraphEdge, GraphNode, SemanticGraph } from "../ir/types.js";
import { analyzeTypeScriptProject } from "../typescript/adapter.js";
import { type GraphLayout, layoutGraph } from "./layout.js";

const { graph: sampleGraph } = analyzeTypeScriptProject([
  {
    path: "src/app.ts",
    text: ['import { save } from "./db";', "export function main(): void {", "  save();", "}"].join(
      "\n",
    ),
  },
  { path: "src/db.ts", text: "export function save(): void {}" },
]);

function boxesOverlap(a: { x: number; y: number; width: number; height: number }, b: typeof a) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function checkInvariants(graph: SemanticGraph, layout: GraphLayout): void {
  // Every graph node has exactly one box.
  expect(layout.nodes.map((n) => n.id).sort()).toEqual(graph.nodes.map((n) => n.id).sort());

  const boxById = new Map(layout.nodes.map((node) => [node.id, node]));
  const parentOf = new Map<string, string>();
  for (const edge of graph.edges) {
    if (edge.kind === "contains") {
      parentOf.set(edge.to, edge.from);
    }
  }

  for (const node of layout.nodes) {
    const parentId = parentOf.get(node.id);
    if (parentId !== undefined) {
      const parent = boxById.get(parentId);
      expect(parent).toBeDefined();
      if (parent) {
        // Children sit fully inside their container.
        expect(node.x).toBeGreaterThanOrEqual(parent.x);
        expect(node.y).toBeGreaterThanOrEqual(parent.y);
        expect(node.x + node.width).toBeLessThanOrEqual(parent.x + parent.width + 0.5);
        expect(node.y + node.height).toBeLessThanOrEqual(parent.y + parent.height + 0.5);
      }
    }
  }

  // Siblings never overlap.
  const bySibling = new Map<string | undefined, typeof layout.nodes>();
  for (const node of layout.nodes) {
    const key = parentOf.get(node.id);
    const list = bySibling.get(key) ?? [];
    list.push(node);
    bySibling.set(key, list);
  }
  for (const siblings of bySibling.values()) {
    for (let i = 0; i < siblings.length; i += 1) {
      for (let j = i + 1; j < siblings.length; j += 1) {
        const a = siblings[i];
        const b = siblings[j];
        if (a && b) {
          expect(boxesOverlap(a, b), `${a.id} overlaps ${b.id}`).toBe(false);
        }
      }
    }
  }

  // Every non-contains edge has a route with at least start and end.
  const routed = new Set(layout.edges.map((edge) => edge.id));
  for (const edge of graph.edges) {
    if (edge.kind !== "contains" && edge.from !== edge.to) {
      expect(routed.has(edge.id), `edge ${edge.id} has no route`).toBe(true);
    }
  }
  for (const edge of layout.edges) {
    expect(edge.points.length).toBeGreaterThanOrEqual(2);
  }
}

describe("layoutGraph", () => {
  it("produces boxes for every node and respects containment", async () => {
    const layout = await layoutGraph(sampleGraph);
    checkInvariants(sampleGraph, layout);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });

  it("is deterministic across runs", async () => {
    const first = await layoutGraph(sampleGraph);
    const second = await layoutGraph(sampleGraph);
    expect(second).toEqual(first);
  });

  it("supports top-down direction", async () => {
    const layout = await layoutGraph(sampleGraph, { direction: "DOWN" });
    checkInvariants(sampleGraph, layout);
  });

  it("lays out 200 nodes well under a second", async () => {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    for (let m = 0; m < 10; m += 1) {
      const modulePath = `src/m${m}.ts`;
      const moduleNodeId = moduleId(modulePath);
      nodes.push({
        id: moduleNodeId,
        kind: "module",
        name: modulePath,
        qualifiedName: modulePath,
      });
      for (let f = 0; f < 19; f += 1) {
        const id = declarationId("function", modulePath, `fn${f}`);
        nodes.push({ id, kind: "function", name: `fn${f}`, qualifiedName: `fn${f}` });
        edges.push({
          id: edgeId("contains", moduleNodeId, id),
          kind: "contains",
          from: moduleNodeId,
          to: id,
        });
        if (f > 0) {
          const previous = declarationId("function", modulePath, `fn${f - 1}`);
          edges.push({ id: edgeId("calls", id, previous), kind: "calls", from: id, to: previous });
        }
      }
    }
    const graph = buildGraph(nodes, edges);
    expect(graph.nodes.length).toBe(200);

    const startedAt = performance.now();
    const layout = await layoutGraph(graph);
    const elapsed = performance.now() - startedAt;
    checkInvariants(graph, layout);
    expect(elapsed).toBeLessThan(1000);
  });
});
