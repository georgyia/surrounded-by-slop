import { describe, expect, it } from "vitest";
import { stronglyConnectedComponents, verticesInCycles } from "./scc.js";

function adjacency(edges: Record<string, string[]>): Map<string, string[]> {
  return new Map(Object.entries(edges));
}

describe("stronglyConnectedComponents", () => {
  it("returns singletons for an acyclic chain", () => {
    const components = stronglyConnectedComponents(adjacency({ a: ["b"], b: ["c"], c: [] }));
    expect(components.map((c) => c.length)).toEqual([1, 1, 1]);
  });

  it("finds a triangle as one component", () => {
    const components = stronglyConnectedComponents(
      adjacency({ a: ["b"], b: ["c"], c: ["a"], d: ["a"] }),
    );
    const triangle = components.find((c) => c.length === 3);
    expect(triangle?.sort()).toEqual(["a", "b", "c"]);
    expect(components.find((c) => c.includes("d"))?.length).toBe(1);
  });

  it("finds two independent cycles", () => {
    const components = stronglyConnectedComponents(
      adjacency({ a: ["b"], b: ["a"], x: ["y"], y: ["x"] }),
    );
    expect(components.filter((c) => c.length === 2)).toHaveLength(2);
  });

  it("ignores edges to unknown vertices", () => {
    const components = stronglyConnectedComponents(adjacency({ a: ["ghost"] }));
    expect(components).toEqual([["a"]]);
  });
});

describe("verticesInCycles", () => {
  it("includes multi-vertex components and self-loops, nothing else", () => {
    const cyclic = verticesInCycles(adjacency({ a: ["b"], b: ["a"], self: ["self"], lone: ["a"] }));
    expect([...cyclic].sort()).toEqual(["a", "b", "self"]);
  });
});
