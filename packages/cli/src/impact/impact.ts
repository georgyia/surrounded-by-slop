import {
  canonicalizeGraph,
  type GraphNode,
  reachedBy,
  type SemanticGraph,
} from "@surrounded-by-slop/core";
import { isTestFile } from "@surrounded-by-slop/host/decisions";
import { formatNodes, symbolText } from "../query/format.js";
import type { ChangedLines } from "./diff.js";

/**
 * The blast radius of a diff (SBS-114): map changed lines to the symbols that
 * enclose them, then walk callers and importers to find everything the change
 * can reach. Pure — git and file discovery happened already; this is graph work.
 */

export interface ImpactOptions {
  /** How many hops of callers/importers to include. Default 2. */
  depth?: number;
}

export interface ImpactResult {
  /** The innermost declarations that contain the changed lines. */
  changed: GraphNode[];
  /** Everything that reaches the changed symbols (excludes the changed set). */
  reached: GraphNode[];
  /** Distinct test files inside the blast radius. */
  tests: string[];
  /** Changed ∪ reached as a subgraph, for `--json`. */
  subgraph: SemanticGraph;
}

/** The narrowest node whose span contains `line` in `file`, or undefined. */
function enclosing(graph: SemanticGraph, file: string, line: number): GraphNode | undefined {
  let best: GraphNode | undefined;
  for (const node of graph.nodes) {
    const span = node.span;
    if (
      span === undefined ||
      span.file !== file ||
      node.kind === "folder" ||
      line < span.startLine ||
      line > span.endLine
    ) {
      continue;
    }
    if (best === undefined) {
      best = node;
      continue;
    }
    // Prefer the deeper (later-starting, then tighter) declaration.
    const bestSpan = best.span;
    if (bestSpan === undefined) {
      best = node;
      continue;
    }
    if (
      span.startLine > bestSpan.startLine ||
      (span.startLine === bestSpan.startLine && span.endLine < bestSpan.endLine)
    ) {
      best = node;
    }
  }
  return best;
}

export function computeImpact(
  graph: SemanticGraph,
  changedLines: ChangedLines,
  options: ImpactOptions = {},
): ImpactResult {
  const depth = options.depth ?? 2;

  const changedIds = new Set<string>();
  for (const [file, lines] of changedLines) {
    for (const line of lines) {
      const node = enclosing(graph, file, line);
      if (node !== undefined) {
        changedIds.add(node.id);
      }
    }
  }

  const kept = new Set(changedIds);
  for (const id of changedIds) {
    for (const node of reachedBy(graph, id, ["calls", "imports"], depth).nodes) {
      kept.add(node.id);
    }
  }

  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const sortNodes = (ids: Iterable<string>): GraphNode[] =>
    [...ids]
      .map((id) => byId.get(id))
      .filter((node): node is GraphNode => node !== undefined)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const changed = sortNodes(changedIds);
  const reachedIds = [...kept].filter((id) => !changedIds.has(id));
  const reached = sortNodes(reachedIds);

  const tests = [
    ...new Set(
      sortNodes(kept)
        .map((node) => node.span?.file)
        .filter((file): file is string => file !== undefined && isTestFile(file)),
    ),
  ].sort();

  const subgraph = canonicalizeGraph({
    schemaVersion: graph.schemaVersion,
    nodes: graph.nodes.filter((node) => kept.has(node.id)),
    edges: graph.edges.filter((edge) => kept.has(edge.from) && kept.has(edge.to)),
  });

  return { changed, reached, tests, subgraph };
}

/** Render an impact result as text, shared by `sbs impact` and the MCP tool. */
export function renderImpact(result: ImpactResult, depth: number): string {
  if (result.changed.length === 0) {
    return "# impact: no analyzable symbols changed";
  }
  const lines = [
    `# impact of ${result.changed.length} changed symbols (depth ${depth})`,
    "changed:",
  ];
  for (const node of result.changed) {
    const where = node.span === undefined ? "" : ` ·${node.span.file}:${node.span.startLine}`;
    lines.push(`  ${symbolText(node)}${where}`);
  }
  lines.push(`reached-by (${result.reached.length}):`);
  lines.push(formatNodes(result.reached));
  if (result.tests.length > 0) {
    lines.push(`tests: ${result.tests.join(", ")}`);
  }
  return lines.join("\n");
}
