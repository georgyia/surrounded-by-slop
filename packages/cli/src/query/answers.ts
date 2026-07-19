import {
  reachableFrom,
  reachedBy,
  type SemanticGraph,
  shortestPath,
  sliceAround,
} from "@surrounded-by-slop/core";
import { formatNode, formatNodes } from "./format.js";
import { type Resolution, resolveModule, resolveSymbol } from "./resolve.js";

/**
 * Pure query answers over a graph — the shared brain behind both `sbs query`
 * (which prints them) and the MCP tools (which return them). Keeping the logic
 * here, free of any I/O, is what lets one implementation serve both surfaces.
 */

export type Answer =
  | { ok: true; text: string; graph?: SemanticGraph; ids?: string[] }
  | { ok: false; message: string };

/** Human-readable explanation of a failed resolution, with suggestions. */
function resolutionMessage(
  resolution: Exclude<Resolution, { kind: "resolved" }>,
  ref: string,
): string {
  if (resolution.kind === "ambiguous") {
    const lines = resolution.candidates.map((node) => `  ${formatNode(node)}`);
    return [`"${ref}" is ambiguous; disambiguate with file:name:`, ...lines].join("\n");
  }
  if (resolution.suggestions.length === 0) {
    return `no symbol matching "${ref}"`;
  }
  const lines = resolution.suggestions.map((node) => `  ${formatNode(node)}`);
  return [`no symbol matching "${ref}"; did you mean:`, ...lines].join("\n");
}

export function answerDefs(graph: SemanticGraph, pattern: string): Answer {
  const needle = pattern.toLowerCase();
  const matches = graph.nodes
    .filter(
      (node) =>
        node.kind !== "module" &&
        node.kind !== "folder" &&
        (node.name.toLowerCase().includes(needle) ||
          node.qualifiedName.toLowerCase().includes(needle)),
    )
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (matches.length === 0) {
    return { ok: false, message: `no definitions matching "${pattern}"` };
  }
  return {
    ok: true,
    text: `# definitions matching "${pattern}" (${matches.length})\n${formatNodes(matches)}`,
    graph: { schemaVersion: graph.schemaVersion, nodes: matches, edges: [] },
  };
}

export function answerReach(
  graph: SemanticGraph,
  ref: string,
  depth: number,
  mode: "callers" | "callees",
): Answer {
  const resolution = resolveSymbol(graph, ref);
  if (resolution.kind !== "resolved") {
    return { ok: false, message: resolutionMessage(resolution, ref) };
  }
  const node = resolution.node;
  const subgraph =
    mode === "callers"
      ? reachedBy(graph, node.id, ["calls"], depth)
      : reachableFrom(graph, node.id, ["calls"], depth);
  const heading = `# ${mode} of ${node.name} (${subgraph.nodes.length - 1})`;
  return {
    ok: true,
    text: `${heading}\n${formatNodes(subgraph.nodes, new Set([node.id]))}`,
    graph: subgraph,
  };
}

export function answerImporters(graph: SemanticGraph, ref: string): Answer {
  const resolution = resolveModule(graph, ref);
  if (resolution.kind !== "resolved") {
    return { ok: false, message: resolutionMessage(resolution, ref) };
  }
  const node = resolution.node;
  const subgraph = reachedBy(graph, node.id, ["imports"]);
  const importers = subgraph.nodes.filter((n) => n.id !== node.id);
  const heading = `# importers of ${node.qualifiedName} (${importers.length})`;
  return {
    ok: true,
    text: `${heading}\n${formatNodes(subgraph.nodes, new Set([node.id]))}`,
    graph: subgraph,
  };
}

export function answerSlice(graph: SemanticGraph, ref: string, depth: number): Answer {
  const resolution = resolveSymbol(graph, ref);
  if (resolution.kind !== "resolved") {
    return { ok: false, message: resolutionMessage(resolution, ref) };
  }
  const node = resolution.node;
  const hops = Number.isFinite(depth) ? depth : 1;
  const subgraph = sliceAround(graph, node.id, hops);
  return {
    ok: true,
    text: `# slice around ${node.name} (depth ${hops})\n${formatNodes(subgraph.nodes)}`,
    graph: subgraph,
  };
}

export function answerPath(graph: SemanticGraph, fromRef: string, toRef: string): Answer {
  const from = resolveSymbol(graph, fromRef);
  if (from.kind !== "resolved") {
    return { ok: false, message: resolutionMessage(from, fromRef) };
  }
  const to = resolveSymbol(graph, toRef);
  if (to.kind !== "resolved") {
    return { ok: false, message: resolutionMessage(to, toRef) };
  }
  const path = shortestPath(graph, from.node.id, to.node.id);
  if (path === undefined) {
    return { ok: true, text: `# no path from ${from.node.name} to ${to.node.name}`, ids: [] };
  }
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const names = path.map((id) => byId.get(id)?.name ?? id);
  return { ok: true, text: `# path: ${names.join(" → ")}`, ids: path };
}
