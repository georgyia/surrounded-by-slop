import type { GraphNode } from "@surrounded-by-slop/core";

/**
 * Shared rendering for query results: the same compact line grammar the repo map
 * uses, so an agent reads one format everywhere. One dense block per query, no
 * paging (ReCUBE: few, complete responses beat chatty retrieval).
 */

const KIND_LABEL: Record<GraphNode["kind"], string> = {
  function: "fn",
  method: "method",
  class: "class",
  interface: "interface",
  enum: "enum",
  variable: "const",
  namespace: "ns",
  module: "module",
  folder: "folder",
};

/** A node's `kind name signature`, without a source location. */
export function symbolText(node: GraphNode): string {
  const label = KIND_LABEL[node.kind];
  const signature = node.signature ?? "";
  const suffix = node.external === true ? " (external)" : "";
  return `${label} ${node.name}${signature}${suffix}`;
}

/** A single node as `kind name signature ·line`. */
export function formatNode(node: GraphNode): string {
  const where = node.span === undefined ? "" : ` ·${node.span.startLine}`;
  return `${symbolText(node)}${where}`;
}

/**
 * A set of nodes grouped by file, files and members in a stable order. Nodes in
 * `exclude` (typically the queried symbol itself) are omitted.
 */
export function formatNodes(nodes: readonly GraphNode[], exclude = new Set<string>()): string {
  const shown = nodes.filter((node) => !exclude.has(node.id));
  if (shown.length === 0) {
    return "  (none)";
  }
  const byFile = new Map<string, GraphNode[]>();
  for (const node of shown) {
    const file = node.span?.file ?? "(external)";
    const bucket = byFile.get(file) ?? [];
    bucket.push(node);
    byFile.set(file, bucket);
  }
  const files = [...byFile.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return files
    .map((file) => {
      const members = (byFile.get(file) ?? [])
        .sort(
          (a, b) => (a.span?.startLine ?? 0) - (b.span?.startLine ?? 0) || (a.id < b.id ? -1 : 1),
        )
        .map((node) => `  ${formatNode(node)}`);
      return `${file}:\n${members.join("\n")}`;
    })
    .join("\n");
}
