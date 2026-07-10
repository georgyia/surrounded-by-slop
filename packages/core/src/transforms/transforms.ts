import { canonicalizeGraph, edgeId } from "../ir/ids.js";
import type { EdgeKind, GraphEdge, GraphNode, SemanticGraph } from "../ir/types.js";
import { matchesAnyGlob } from "./glob.js";

/**
 * Pure transforms over the IR — the machinery behind every "this diagram is
 * too big" feature. Inputs are never mutated; outputs are canonical and pass
 * the structural validator (property-tested).
 */

export interface FilterOptions {
  /** Keep only these node kinds (default: all). */
  kinds?: readonly GraphNode["kind"][];
  /** Keep only nodes whose path matches one of these globs (default: all). */
  include?: readonly string[];
  /** Drop nodes whose path matches one of these globs. */
  exclude?: readonly string[];
}

/** The path a node filters by: its source file, or its name for synthetic nodes. */
function pathOf(node: GraphNode): string {
  return node.span?.file ?? node.qualifiedName;
}

export function filterGraph(graph: SemanticGraph, options: FilterOptions): SemanticGraph {
  const kinds = options.kinds === undefined ? undefined : new Set(options.kinds);
  const kept = new Set<string>();
  for (const node of graph.nodes) {
    if (kinds !== undefined && !kinds.has(node.kind)) {
      continue;
    }
    const nodePath = pathOf(node);
    if (options.include !== undefined && !matchesAnyGlob(nodePath, options.include)) {
      continue;
    }
    if (options.exclude !== undefined && matchesAnyGlob(nodePath, options.exclude)) {
      continue;
    }
    kept.add(node.id);
  }
  return subgraph(graph, kept);
}

/** The nodes in `kept`, plus every edge whose endpoints both survive. */
function subgraph(graph: SemanticGraph, kept: ReadonlySet<string>): SemanticGraph {
  return canonicalizeGraph({
    schemaVersion: graph.schemaVersion,
    nodes: graph.nodes.filter((node) => kept.has(node.id)),
    edges: graph.edges.filter((edge) => kept.has(edge.from) && kept.has(edge.to)),
  });
}

/** Containment parent lookup: child id → parent id. */
function containsParents(graph: SemanticGraph): Map<string, string> {
  const parents = new Map<string, string>();
  for (const edge of graph.edges) {
    if (edge.kind === "contains") {
      parents.set(edge.to, edge.from);
    }
  }
  return parents;
}

/**
 * Folds every node into its containing module: members disappear, their
 * edges lift to module level (counts summed, self-loops dropped). Parentless
 * non-module nodes (external packages, unresolved sinks) survive unchanged.
 */
export function collapseToModules(graph: SemanticGraph): SemanticGraph {
  const parents = containsParents(graph);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const target = new Map<string, string>();
  for (const node of graph.nodes) {
    let current: GraphNode = node;
    while (current.kind !== "module" && current.kind !== "folder") {
      const parentId = parents.get(current.id);
      const parent = parentId === undefined ? undefined : nodeById.get(parentId);
      if (parent === undefined) {
        break;
      }
      current = parent;
    }
    target.set(node.id, current.id);
  }
  const keptNodes = graph.nodes.filter((node) => target.get(node.id) === node.id);
  return canonicalizeGraph({
    schemaVersion: graph.schemaVersion,
    nodes: keptNodes,
    edges: liftEdges(graph.edges, target, { dropKinds: new Set(["contains"]) }),
  });
}

/**
 * Groups modules by their leading `depth` path segments into `folder` nodes.
 * Modules shallower than `depth` (including root files), external packages
 * and sinks survive unchanged — that is what makes progressive drill-down
 * work: depth 2 shows `src/app.ts` as a module next to `folder:src/store`.
 * The result is member-free (collapses to modules first).
 */
export function collapseToFolders(graph: SemanticGraph, depth = 1): SemanticGraph {
  const groupDepth = Math.max(depth, 1);
  const moduleLevel = collapseToModules(graph);
  const target = new Map<string, string>();
  const folders = new Map<string, GraphNode>();
  for (const node of moduleLevel.nodes) {
    if (node.kind !== "module" || node.external === true || node.span === undefined) {
      target.set(node.id, node.id);
      continue;
    }
    const segments = node.qualifiedName.split("/");
    const directorySegments = segments.length - 1;
    if (directorySegments < groupDepth) {
      target.set(node.id, node.id);
      continue;
    }
    const folderPath = segments.slice(0, groupDepth).join("/");
    const folderId = `folder:${folderPath}`;
    if (!folders.has(folderId)) {
      folders.set(folderId, {
        id: folderId,
        kind: "folder",
        name: segments[groupDepth - 1] ?? folderPath,
        qualifiedName: folderPath,
      });
    }
    target.set(node.id, folderId);
  }
  const keptModules = moduleLevel.nodes.filter((node) => target.get(node.id) === node.id);
  return canonicalizeGraph({
    schemaVersion: moduleLevel.schemaVersion,
    nodes: [...keptModules, ...folders.values()],
    edges: liftEdges(moduleLevel.edges, target, { dropKinds: new Set(["contains"]) }),
  });
}

interface LiftOptions {
  dropKinds: ReadonlySet<EdgeKind>;
}

/** Re-points edges through `target`, dropping self-loops and merging duplicates. */
function liftEdges(
  edges: readonly GraphEdge[],
  target: ReadonlyMap<string, string>,
  options: LiftOptions,
): GraphEdge[] {
  const merged = new Map<string, GraphEdge>();
  for (const edge of edges) {
    if (options.dropKinds.has(edge.kind)) {
      continue;
    }
    const from = target.get(edge.from) ?? edge.from;
    const to = target.get(edge.to) ?? edge.to;
    if (from === to) {
      continue;
    }
    const id = edgeId(edge.kind, from, to);
    const existing = merged.get(id);
    if (existing === undefined) {
      const lifted: GraphEdge = { ...edge, id, from, to };
      merged.set(id, lifted);
      continue;
    }
    existing.count = (existing.count ?? 1) + (edge.count ?? 1);
    if (existing.typeOnly && !edge.typeOnly) {
      delete existing.typeOnly;
    }
    if (existing.confidence === "low" && edge.confidence === undefined) {
      delete existing.confidence;
    }
    if (edge.inCycle) {
      existing.inCycle = true;
    }
  }
  return [...merged.values()];
}

/**
 * The neighborhood of a node: everything within `depth` steps over
 * non-contains edges (both directions), plus containment ancestors of every
 * kept node for context. Throws if the node does not exist.
 */
export function sliceAround(graph: SemanticGraph, centerId: string, depth = 1): SemanticGraph {
  if (!graph.nodes.some((node) => node.id === centerId)) {
    throw new Error(`sliceAround: node ${centerId} is not in the graph`);
  }
  const neighbors = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.kind === "contains") {
      continue;
    }
    const forward = neighbors.get(edge.from) ?? [];
    forward.push(edge.to);
    neighbors.set(edge.from, forward);
    const backward = neighbors.get(edge.to) ?? [];
    backward.push(edge.from);
    neighbors.set(edge.to, backward);
  }

  const kept = new Set<string>([centerId]);
  let frontier = [centerId];
  for (let step = 0; step < depth; step += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbor of neighbors.get(id) ?? []) {
        if (!kept.has(neighbor)) {
          kept.add(neighbor);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
  }

  const parents = containsParents(graph);
  for (const id of [...kept]) {
    let current = parents.get(id);
    while (current !== undefined && !kept.has(current)) {
      kept.add(current);
      current = parents.get(current);
    }
  }
  return subgraph(graph, kept);
}

/**
 * Forward reachability from a node over the given edge kinds (default:
 * calls + imports). Returns the reachable subgraph including the start node;
 * containment edges among kept nodes survive for context.
 */
export function reachableFrom(
  graph: SemanticGraph,
  startId: string,
  kinds: readonly EdgeKind[] = ["calls", "imports"],
): SemanticGraph {
  if (!graph.nodes.some((node) => node.id === startId)) {
    throw new Error(`reachableFrom: node ${startId} is not in the graph`);
  }
  const wanted = new Set(kinds);
  const forward = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (!wanted.has(edge.kind)) {
      continue;
    }
    const list = forward.get(edge.from) ?? [];
    list.push(edge.to);
    forward.set(edge.from, list);
  }
  const kept = new Set<string>([startId]);
  const queue = [startId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) {
      break;
    }
    for (const next of forward.get(current) ?? []) {
      if (!kept.has(next)) {
        kept.add(next);
        queue.push(next);
      }
    }
  }
  return subgraph(graph, kept);
}
