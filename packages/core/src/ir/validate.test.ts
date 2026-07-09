import { describe, expect, it } from "vitest";
import type { GraphEdge, GraphNode, SemanticGraph } from "./types.js";
import { validateGraph } from "./validate.js";

function node(id: string, overrides: Partial<GraphNode> = {}): GraphNode {
  const kind = id.split(":")[0] as GraphNode["kind"];
  return { id, kind, name: id, qualifiedName: id, ...overrides };
}

function edge(
  kind: GraphEdge["kind"],
  from: string,
  to: string,
  overrides: Partial<GraphEdge> = {},
): GraphEdge {
  return { id: `${kind}:${from}->${to}`, kind, from, to, ...overrides };
}

function graph(nodes: GraphNode[], edges: GraphEdge[]): SemanticGraph {
  return { schemaVersion: 1, nodes, edges };
}

const a = node("module:a.ts");
const b = node("module:b.ts");

describe("validateGraph", () => {
  it("accepts a valid canonical graph", () => {
    const g = graph([a, b], [edge("imports", a.id, b.id)]);
    expect(validateGraph(g)).toEqual([]);
  });

  it("rejects unknown schema versions", () => {
    const g = { ...graph([], []), schemaVersion: 2 as 1 };
    expect(validateGraph(g)).toEqual(["unknown schemaVersion 2"]);
  });

  it("rejects duplicate node ids", () => {
    expect(validateGraph(graph([a, a], []))).toContain("duplicate node id module:a.ts");
  });

  it("rejects nodes out of canonical order", () => {
    expect(validateGraph(graph([b, a], [])).join()).toMatch(/not in canonical order/);
  });

  it("rejects node ids that contradict their kind", () => {
    const wrong = { ...node("module:a.ts"), kind: "class" as const };
    expect(validateGraph(graph([wrong], [])).join()).toMatch(/does not match its kind/);
  });

  it("rejects edges to missing nodes", () => {
    const g = graph([a], [edge("imports", a.id, "module:ghost.ts")]);
    expect(validateGraph(g).join()).toMatch(/missing node module:ghost.ts/);
  });

  it("rejects edge ids that are not derived from endpoints", () => {
    const bad = { ...edge("imports", a.id, b.id), id: "imports:handwritten" };
    expect(validateGraph(graph([a, b], [bad])).join()).toMatch(/not derived/);
  });

  it("rejects duplicate and unordered edges", () => {
    const e1 = edge("imports", a.id, b.id);
    const e0 = edge("calls", a.id, b.id);
    expect(validateGraph(graph([a, b], [e1, e1])).join()).toMatch(/duplicate edge/);
    expect(validateGraph(graph([a, b], [e1, e0])).join()).toMatch(/not in canonical order/);
  });

  it("rejects invalid counts and misplaced properties", () => {
    const g = graph(
      [a, b],
      [
        edge("calls", a.id, b.id, { count: 1 }),
        edge("extends", a.id, b.id, { typeOnly: true }),
        edge("implements", a.id, b.id, { confidence: "low" }),
        edge("imports", a.id, b.id, { confidence: "low" }),
      ],
    );
    const problems = validateGraph(g).join("\n");
    expect(problems).toMatch(/invalid count 1/);
    expect(problems).toMatch(/carries typeOnly on kind extends/);
    expect(problems).toMatch(/carries confidence on kind implements/);
    expect(problems).toMatch(/carries confidence on kind imports/);
  });

  it("rejects spans before 1:1, inverted spans and backslash paths", () => {
    const zero = node("module:a.ts", {
      span: { file: "a.ts", startLine: 0, startCol: 1, endLine: 1, endCol: 1 },
    });
    const inverted = node("module:a.ts", {
      span: { file: "a.ts", startLine: 2, startCol: 1, endLine: 1, endCol: 1 },
    });
    const sameLine = node("module:a.ts", {
      span: { file: "a.ts", startLine: 1, startCol: 5, endLine: 1, endCol: 2 },
    });
    const backslash = node("module:a.ts", {
      span: { file: "src\\a.ts", startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
    });
    expect(validateGraph(graph([zero], [])).join()).toMatch(/before 1:1/);
    expect(validateGraph(graph([inverted], [])).join()).toMatch(/ending before it starts/);
    expect(validateGraph(graph([sameLine], [])).join()).toMatch(/ending before it starts/);
    expect(validateGraph(graph([backslash], [])).join()).toMatch(/backslashes/);
  });

  it("rejects multiple containment parents and containment cycles", () => {
    const c = node("class:a.ts#C");
    const twoParents = graph(
      [a, b, c],
      [edge("contains", a.id, c.id), edge("contains", b.id, c.id)],
    );
    expect(validateGraph(twoParents).join()).toMatch(/multiple contains parents/);

    const cycle = graph([a, b], [edge("contains", a.id, b.id), edge("contains", b.id, a.id)]);
    expect(validateGraph(cycle).join()).toMatch(/containment cycle/);
  });
});
