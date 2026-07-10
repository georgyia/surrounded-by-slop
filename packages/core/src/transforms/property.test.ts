import { describe, expect, it } from "vitest";
import { buildGraph, declarationId, edgeId, moduleId } from "../ir/ids.js";
import type { GraphEdge, GraphNode, SemanticGraph } from "../ir/types.js";
import { validateGraph } from "../ir/validate.js";
import {
  collapseToFolders,
  collapseToModules,
  filterGraph,
  reachableFrom,
  sliceAround,
} from "./transforms.js";

/**
 * Property tests over seeded pseudo-random graphs: every transform output
 * must validate, stay a subset (where applicable) and be deterministic.
 * No property-testing dependency — a 10-line PRNG is all this needs (Rule 3).
 */

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomGraph(seed: number): SemanticGraph {
  const random = mulberry32(seed);
  const pick = (limit: number): number => Math.floor(random() * limit);

  const nodes: GraphNode[] = [];
  const callables: string[] = [];
  const modules: string[] = [];
  const edges = new Map<string, GraphEdge>();

  const addEdge = (kind: GraphEdge["kind"], from: string, to: string): void => {
    const id = edgeId(kind, from, to);
    const existing = edges.get(id);
    if (existing) {
      existing.count = (existing.count ?? 1) + 1;
    } else {
      edges.set(id, { id, kind, from, to });
    }
  };

  const moduleCount = 1 + pick(4);
  for (let m = 0; m < moduleCount; m += 1) {
    const depth = pick(3);
    const dir = ["src", "lib", "src/inner"][pick(3)] ?? "src";
    const path = depth === 0 ? `file${m}.ts` : `${dir}/file${m}.ts`;
    const id = moduleId(path);
    nodes.push({
      id,
      kind: "module",
      name: path,
      qualifiedName: path,
      span: { file: path, startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
    });
    modules.push(id);

    const functionCount = pick(4);
    for (let f = 0; f < functionCount; f += 1) {
      const functionId = declarationId("function", path, `fn${f}`);
      nodes.push({
        id: functionId,
        kind: "function",
        name: `fn${f}`,
        qualifiedName: `fn${f}`,
        span: { file: path, startLine: f + 2, startCol: 1, endLine: f + 2, endCol: 10 },
      });
      callables.push(functionId);
      addEdge("contains", id, functionId);
    }
  }

  const callCount = pick(callables.length * 2 + 1);
  for (let c = 0; c < callCount && callables.length > 1; c += 1) {
    const from = callables[pick(callables.length)];
    const to = callables[pick(callables.length)];
    if (from !== undefined && to !== undefined && from !== to) {
      addEdge("calls", from, to);
    }
  }
  const importCount = pick(modules.length * 2 + 1);
  for (let i = 0; i < importCount && modules.length > 1; i += 1) {
    const from = modules[pick(modules.length)];
    const to = modules[pick(modules.length)];
    if (from !== undefined && to !== undefined && from !== to) {
      addEdge("imports", from, to);
    }
  }

  return buildGraph(nodes, [...edges.values()]);
}

const seeds = Array.from({ length: 30 }, (_, index) => index + 1);

describe.each(seeds)("random graph (seed %i)", (seed) => {
  const graph = randomGraph(seed);
  const nodeIds = new Set(graph.nodes.map((node) => node.id));

  it("generator produces a valid graph", () => {
    expect(validateGraph(graph)).toEqual([]);
  });

  it("every transform output validates and subsets hold", () => {
    const filtered = filterGraph(graph, { kinds: ["module", "function"], include: ["src/**"] });
    expect(validateGraph(filtered)).toEqual([]);
    expect(filtered.nodes.every((node) => nodeIds.has(node.id))).toBe(true);

    const collapsed = collapseToModules(graph);
    expect(validateGraph(collapsed)).toEqual([]);
    expect(collapsed.nodes.every((node) => nodeIds.has(node.id))).toBe(true);

    const folders = collapseToFolders(graph, 1);
    expect(validateGraph(folders)).toEqual([]);

    const start = graph.nodes[0];
    if (start !== undefined) {
      const slice = sliceAround(graph, start.id, 2);
      expect(validateGraph(slice)).toEqual([]);
      expect(slice.nodes.every((node) => nodeIds.has(node.id))).toBe(true);

      const reachable = reachableFrom(graph, start.id);
      expect(validateGraph(reachable)).toEqual([]);
      expect(reachable.nodes.every((node) => nodeIds.has(node.id))).toBe(true);
    }
  });

  it("transforms compose and stay valid", () => {
    const collapsed = collapseToModules(graph);
    const module = collapsed.nodes.find((node) => node.kind === "module");
    if (module !== undefined) {
      const sliceOfCollapse = sliceAround(collapsed, module.id, 1);
      expect(validateGraph(sliceOfCollapse)).toEqual([]);
      const filteredSlice = filterGraph(sliceOfCollapse, { include: ["**"] });
      expect(validateGraph(filteredSlice)).toEqual([]);
    }
  });

  it("collapse is idempotent and transforms are deterministic", () => {
    const once = collapseToModules(graph);
    expect(collapseToModules(once)).toEqual(once);
    expect(collapseToModules(graph)).toEqual(once);
    expect(filterGraph(graph, { exclude: ["lib/**"] })).toEqual(
      filterGraph(graph, { exclude: ["lib/**"] }),
    );
  });

  it("transforms never mutate their input", () => {
    const before = JSON.stringify(graph);
    collapseToModules(graph);
    collapseToFolders(graph, 1);
    filterGraph(graph, { kinds: ["module"] });
    expect(JSON.stringify(graph)).toBe(before);
  });
});
