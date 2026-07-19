import type { GraphEdge, SemanticGraph } from "../ir/types.js";

/**
 * Importance ranking over the IR (SBS-111) — the machinery that decides which
 * symbols a token-budgeted repo map keeps and which it drops.
 *
 * A weighted PageRank over `calls` and `imports` edges: a node is important when
 * important nodes point at it. Weights lean on signals the IR already carries —
 * `count` (how often the edge occurs), `confidence` (heuristic calls count for
 * less), `typeOnly` (type-only imports are a weak structural signal).
 *
 * Deterministic by construction (Rule 6): a fixed iteration count rather than a
 * convergence epsilon, node iteration in sorted-id order, and lexicographic
 * tie-breaking. The same graph yields byte-identical scores on every platform.
 * Ranking is derived data — the graph is never mutated and nothing is stored on
 * it (see the transform section of `docs/ir-spec.md`).
 */

export interface RankOptions {
  /** Damping factor — the PageRank random-restart probability. Default 0.85. */
  damping?: number;
  /** Number of power-iteration passes. Fixed, not epsilon-based, for determinism. Default 40. */
  iterations?: number;
  /**
   * Nodes to bias the ranking toward (personalization vector). When set, the
   * random restart lands only on these nodes, so scores measure importance
   * *relative to* the seeds — the hook for future task-focused maps. Ids absent
   * from the graph are ignored; an empty or all-absent set falls back to uniform.
   */
  seeds?: readonly string[];
}

export interface RankedNode {
  id: string;
  /** PageRank score in (0, 1]; scores over all nodes sum to ≈ 1. */
  score: number;
}

interface OutEdge {
  to: string;
  weight: number;
}

/** Edge weight from the IR signals. Confident value edges count fullest. */
function edgeWeight(edge: GraphEdge): number {
  let weight = edge.count ?? 1;
  if (edge.confidence === "low") {
    weight *= 0.5;
  }
  if (edge.typeOnly === true) {
    weight *= 0.25;
  }
  return weight;
}

/**
 * Rank every node in the graph by weighted PageRank over its call/import edges.
 * Returns all nodes, most important first; ties broken by ascending id so the
 * order is total and stable.
 */
export function rankNodes(graph: SemanticGraph, options: RankOptions = {}): RankedNode[] {
  const damping = options.damping ?? 0.85;
  const iterations = options.iterations ?? 40;

  // Sorted ids give every loop below a deterministic, platform-independent order.
  const ids = graph.nodes.map((node) => node.id).sort();
  const n = ids.length;
  if (n === 0) {
    return [];
  }
  const present = new Set(ids);

  // Restart distribution: uniform, or concentrated on the seeds when given.
  const seeds = (options.seeds ?? []).filter((id) => present.has(id));
  const restart = new Map<string, number>();
  if (seeds.length > 0) {
    for (const id of seeds) {
      restart.set(id, 1 / seeds.length);
    }
  } else {
    for (const id of ids) {
      restart.set(id, 1 / n);
    }
  }

  // Weighted out-edges and per-node out-weight over calls + imports only.
  const outEdges = new Map<string, OutEdge[]>();
  const outWeight = new Map<string, number>();
  for (const edge of graph.edges) {
    if (edge.kind !== "calls" && edge.kind !== "imports") {
      continue;
    }
    if (!present.has(edge.from) || !present.has(edge.to)) {
      continue;
    }
    const weight = edgeWeight(edge);
    const list = outEdges.get(edge.from) ?? [];
    list.push({ to: edge.to, weight });
    outEdges.set(edge.from, list);
    outWeight.set(edge.from, (outWeight.get(edge.from) ?? 0) + weight);
  }

  let score = new Map(restart);
  for (let pass = 0; pass < iterations; pass += 1) {
    const next = new Map<string, number>();
    let dangling = 0;
    for (const id of ids) {
      const mass = score.get(id) ?? 0;
      const total = outWeight.get(id) ?? 0;
      if (total === 0) {
        // Dangling node: its mass is redistributed via the restart vector.
        dangling += mass;
        continue;
      }
      const share = (damping * mass) / total;
      for (const edge of outEdges.get(id) ?? []) {
        next.set(edge.to, (next.get(edge.to) ?? 0) + share * edge.weight);
      }
    }
    const teleport = 1 - damping + damping * dangling;
    for (const id of ids) {
      next.set(id, (next.get(id) ?? 0) + teleport * (restart.get(id) ?? 0));
    }
    score = next;
  }

  return ids
    .map((id) => ({ id, score: score.get(id) ?? 0 }))
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.id < b.id ? -1 : 1));
}
