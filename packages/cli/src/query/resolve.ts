import type { GraphNode, SemanticGraph } from "@surrounded-by-slop/core";

/**
 * Turning an agent's symbol reference into a graph node. A reference matches by
 * bare name, dot-qualified name, `file:qualifiedName`, or full id. A miss is not
 * a dead end: we return nearest-name suggestions so a typo costs one retry, and
 * an ambiguous reference returns every candidate so the agent can disambiguate
 * with `file:name` (SBS-113).
 */

export type Resolution =
  | { kind: "resolved"; node: GraphNode }
  | { kind: "ambiguous"; candidates: GraphNode[] }
  | { kind: "unknown"; suggestions: GraphNode[] };

function addressForms(node: GraphNode): string[] {
  const forms = [node.name, node.qualifiedName, node.id];
  if (node.span !== undefined) {
    forms.push(`${node.span.file}:${node.qualifiedName}`, `${node.span.file}:${node.name}`);
  }
  return forms;
}

/** Resolve a symbol reference, optionally restricted to certain node kinds. */
export function resolveSymbol(
  graph: SemanticGraph,
  pattern: string,
  kinds?: readonly GraphNode["kind"][],
): Resolution {
  const kindSet = kinds === undefined ? undefined : new Set(kinds);
  const eligible = graph.nodes.filter((node) => kindSet === undefined || kindSet.has(node.kind));

  const exact = eligible.filter((node) => addressForms(node).includes(pattern));
  if (exact.length === 1) {
    const [node] = exact;
    if (node !== undefined) {
      return { kind: "resolved", node };
    }
  }
  if (exact.length > 1) {
    return { kind: "ambiguous", candidates: sortNodes(exact) };
  }

  const needle = pattern.toLowerCase();
  const suggestions = sortNodes(
    eligible.filter(
      (node) =>
        node.name.toLowerCase().includes(needle) ||
        node.qualifiedName.toLowerCase().includes(needle),
    ),
  ).slice(0, 5);
  return { kind: "unknown", suggestions };
}

/** Resolve a file reference to its module node. */
export function resolveModule(graph: SemanticGraph, file: string): Resolution {
  const normalized = file.split("\\").join("/");
  const matches = graph.nodes.filter(
    (node) =>
      node.kind === "module" &&
      (node.qualifiedName === normalized ||
        node.span?.file === normalized ||
        node.id === `module:${normalized}`),
  );
  if (matches.length === 1) {
    const [node] = matches;
    if (node !== undefined) {
      return { kind: "resolved", node };
    }
  }
  if (matches.length > 1) {
    return { kind: "ambiguous", candidates: sortNodes(matches) };
  }
  const needle = normalized.toLowerCase();
  const suggestions = sortNodes(
    graph.nodes.filter(
      (node) => node.kind === "module" && node.qualifiedName.toLowerCase().includes(needle),
    ),
  ).slice(0, 5);
  return { kind: "unknown", suggestions };
}

function sortNodes(nodes: readonly GraphNode[]): GraphNode[] {
  return [...nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
