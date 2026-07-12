/**
 * Hover-card content (SBS-064) derived purely from the graph, so it can be
 * unit-tested without a DOM. `main.ts` positions a card and fills it with these
 * fields; it never re-queries the host.
 */
import type { GraphNode, SemanticGraph } from "@surrounded-by-slop/core";

export interface Degree {
  readonly incoming: number;
  readonly outgoing: number;
}

export interface HoverDetails {
  readonly name: string;
  readonly kind: string;
  /** Undefined when the node has no rendered signature / doc / source. */
  readonly signature: string | undefined;
  readonly doc: string | undefined;
  readonly location: string | undefined;
  readonly incoming: number;
  readonly outgoing: number;
}

/** In/out degree per node over real relationships (containment doesn't count). */
export function edgeDegrees(graph: SemanticGraph): Map<string, Degree> {
  const degrees = new Map<string, { incoming: number; outgoing: number }>();
  const bump = (id: string, key: "incoming" | "outgoing"): void => {
    const current = degrees.get(id) ?? { incoming: 0, outgoing: 0 };
    current[key] += 1;
    degrees.set(id, current);
  };
  for (const edge of graph.edges) {
    if (edge.kind === "contains") {
      continue;
    }
    bump(edge.from, "outgoing");
    bump(edge.to, "incoming");
  }
  return degrees;
}

/** The card's fields for one node, given a precomputed degree map. */
export function hoverDetails(node: GraphNode, degrees: ReadonlyMap<string, Degree>): HoverDetails {
  const degree = degrees.get(node.id) ?? { incoming: 0, outgoing: 0 };
  return {
    name: node.name,
    kind: node.kind,
    signature: node.signature,
    doc: node.doc,
    location: node.span === undefined ? undefined : `${node.span.file}:${node.span.startLine}`,
    incoming: degree.incoming,
    outgoing: degree.outgoing,
  };
}
