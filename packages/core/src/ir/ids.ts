import type { EdgeKind, GraphEdge, GraphNode, NodeKind, SemanticGraph } from "./types.js";

/**
 * Id construction — the determinism backbone (see docs/ir-spec.md).
 * Ids derive from what a thing *is* (kind, path, qualified name), never from
 * traversal order or object identity, so unrelated edits never move ids.
 */

/** Id for a module node from its root-relative path. */
export function moduleId(path: string): string {
  return `module:${path}`;
}

/** Id for an external package node. */
export function externalModuleId(packageName: string): string {
  return `module:external:${packageName}`;
}

/** Id for a declaration inside a module. */
export function declarationId(kind: NodeKind, path: string, qualifiedName: string): string {
  return `${kind}:${path}#${qualifiedName}`;
}

/** Id for the shared sink of unresolved calls to `name`. */
export function unresolvedFunctionId(name: string): string {
  return `function:unresolved#${name}`;
}

/** Derived edge id. */
export function edgeId(kind: EdgeKind, from: string, to: string): string {
  return `${kind}:${from}->${to}`;
}

/**
 * Allocates ids within one analysis, resolving genuine collisions (same kind
 * and qualified name, e.g. same-named functions in sibling blocks) with a
 * `~2`, `~3`… suffix in source order. The first occurrence stays unsuffixed
 * so common cases never carry noise.
 */
export class IdAllocator {
  private readonly used = new Map<string, number>();

  allocate(baseId: string): string {
    const seen = this.used.get(baseId);
    if (seen === undefined) {
      this.used.set(baseId, 1);
      return baseId;
    }
    this.used.set(baseId, seen + 1);
    return `${baseId}~${seen + 1}`;
  }
}

function compareById(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The single sorting point: returns a copy of the graph in canonical order
 * (nodes and edges sorted by id). Input arrays are not mutated.
 */
export function canonicalizeGraph(graph: SemanticGraph): SemanticGraph {
  return {
    schemaVersion: graph.schemaVersion,
    nodes: [...graph.nodes].sort(compareById),
    edges: [...graph.edges].sort(compareById),
  };
}

/** Convenience for building a canonical graph from collected parts. */
export function buildGraph(nodes: GraphNode[], edges: GraphEdge[]): SemanticGraph {
  return canonicalizeGraph({ schemaVersion: 1, nodes, edges });
}
