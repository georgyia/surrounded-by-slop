import { canonicalizeGraph, edgeId } from "../ir/ids.js";
import type { GraphEdge, GraphNode, SemanticGraph } from "../ir/types.js";

/**
 * Move a graph's project files under a path prefix (#74).
 *
 * A multi-root workspace is several independent projects, so each root is
 * analyzed on its own — with its own tsconfig aliases, and with import
 * resolution that sees only that root's files, exactly as a single-root
 * analysis does. Only afterwards are the results moved into one namespace, so
 * two roots that each contain `src/index.ts` stop colliding.
 *
 * Doing it in this order is what keeps every adapter honest: prefixing the
 * paths *before* analysis would break resolvers that look a module path up in
 * the file set (a Python `import shop.cart` would no longer find
 * `shop/cart.py`), and the map would go quietly wrong rather than loudly
 * broken.
 *
 * External packages and unresolved-call sinks are left alone: they name no
 * project file, and `react` is the same `react` whichever root imported it —
 * which is also what lets the merged map show one shared node for it.
 */
export function rebaseGraph(graph: SemanticGraph, prefix: string): SemanticGraph {
  if (prefix === "") {
    return graph;
  }
  const rebasedId = new Map<string, string>();

  const nodes: GraphNode[] = graph.nodes.map((node) => {
    if (!isProjectNode(node)) {
      return node;
    }
    // Ids are `kind:path` for a module and `kind:path#qualifiedName` for a
    // declaration (see ir/ids.ts), so the path is the one segment to move.
    const separator = node.id.indexOf(":");
    const kind = node.id.slice(0, separator);
    const rest = node.id.slice(separator + 1);
    const hash = rest.indexOf("#");
    const path = hash === -1 ? rest : rest.slice(0, hash);
    const suffix = hash === -1 ? "" : rest.slice(hash);
    const movedPath = `${prefix}/${path}`;
    const id = `${kind}:${movedPath}${suffix}`;
    rebasedId.set(node.id, id);
    return {
      ...node,
      id,
      // A module's qualified name *is* its path; a declaration's is its
      // symbol name and must not move.
      ...(node.kind === "module" ? { qualifiedName: movedPath } : {}),
      ...(node.span === undefined ? {} : { span: { ...node.span, file: movedPath } }),
    };
  });

  const edges: GraphEdge[] = graph.edges.map((edge) => {
    const from = rebasedId.get(edge.from) ?? edge.from;
    const to = rebasedId.get(edge.to) ?? edge.to;
    if (from === edge.from && to === edge.to) {
      return edge;
    }
    // Edge ids embed their endpoints, so they are rebuilt rather than patched.
    return {
      ...edge,
      id: edgeId(edge.kind, from, to),
      from,
      to,
      ...(edge.span === undefined
        ? {}
        : { span: { ...edge.span, file: `${prefix}/${edge.span.file}` } }),
    };
  });

  return canonicalizeGraph({ schemaVersion: graph.schemaVersion, nodes, edges });
}

/** A node that names a file in this project, as opposed to a package or a sink. */
function isProjectNode(node: GraphNode): boolean {
  return node.external !== true && !node.id.startsWith("function:unresolved#");
}
