import type { GraphNode, SemanticGraph } from "@surrounded-by-slop/core";
import { describe, expect, it } from "vitest";
import { edgeDegrees, hoverDetails } from "./hover.js";

const graph: SemanticGraph = {
  schemaVersion: 1,
  nodes: [
    {
      id: "a",
      kind: "function",
      name: "place",
      qualifiedName: "place",
      signature: "(order: Order): string",
      doc: "Places an order.",
      span: { file: "src/orders.ts", startLine: 12, startCol: 1, endLine: 20, endCol: 1 },
    },
    { id: "b", kind: "function", name: "charge", qualifiedName: "charge" },
    { id: "c", kind: "function", name: "notify", qualifiedName: "notify" },
  ],
  edges: [
    { id: "calls:a->b", kind: "calls", from: "a", to: "b" },
    { id: "calls:a->c", kind: "calls", from: "a", to: "c" },
    { id: "contains:m->a", kind: "contains", from: "m", to: "a" },
  ],
};

describe("edgeDegrees", () => {
  it("counts in/out edges, ignoring containment", () => {
    const degrees = edgeDegrees(graph);
    expect(degrees.get("a")).toEqual({ incoming: 0, outgoing: 2 });
    expect(degrees.get("b")).toEqual({ incoming: 1, outgoing: 0 });
  });
});

describe("hoverDetails", () => {
  const degrees = edgeDegrees(graph);

  it("surfaces signature, doc, file:line and degree", () => {
    const node = graph.nodes[0] as GraphNode;
    expect(hoverDetails(node, degrees)).toEqual({
      name: "place",
      kind: "function",
      signature: "(order: Order): string",
      doc: "Places an order.",
      location: "src/orders.ts:12",
      incoming: 0,
      outgoing: 2,
    });
  });

  it("leaves optional fields undefined and degree zero for a bare node", () => {
    const node = graph.nodes[2] as GraphNode;
    const details = hoverDetails(node, degrees);
    expect(details.signature).toBeUndefined();
    expect(details.location).toBeUndefined();
    expect(details).toMatchObject({ incoming: 1, outgoing: 0 });
  });
});
