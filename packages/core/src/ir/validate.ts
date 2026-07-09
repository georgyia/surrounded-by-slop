import { edgeId } from "./ids.js";
import type { SemanticGraph, SourceSpan } from "./types.js";

/**
 * Structural validator — the machine check every golden fixture runs through
 * (docs/ir-spec.md "Validation"). Returns human-readable problems; an empty
 * array means the graph is valid. Never throws.
 */
export function validateGraph(graph: SemanticGraph): string[] {
  const problems: string[] = [];

  if (graph.schemaVersion !== 1) {
    problems.push(`unknown schemaVersion ${String(graph.schemaVersion)}`);
  }

  const nodeIds = new Set<string>();
  let previousNodeId = "";
  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) {
      problems.push(`duplicate node id ${node.id}`);
    }
    nodeIds.add(node.id);
    if (node.id < previousNodeId) {
      problems.push(`nodes not in canonical order at ${node.id}`);
    }
    previousNodeId = node.id;
    if (!node.id.startsWith(`${node.kind}:`)) {
      problems.push(`node ${node.id} does not match its kind ${node.kind}`);
    }
    if (node.span) {
      problems.push(...spanProblems(node.span, `node ${node.id}`));
    }
  }

  const edgeIds = new Set<string>();
  const containsParent = new Map<string, string>();
  let previousEdgeId = "";
  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) {
      problems.push(`duplicate edge id ${edge.id}`);
    }
    edgeIds.add(edge.id);
    if (edge.id < previousEdgeId) {
      problems.push(`edges not in canonical order at ${edge.id}`);
    }
    previousEdgeId = edge.id;
    if (edge.id !== edgeId(edge.kind, edge.from, edge.to)) {
      problems.push(`edge id ${edge.id} is not derived from its kind and endpoints`);
    }
    if (!nodeIds.has(edge.from)) {
      problems.push(`edge ${edge.id} points from missing node ${edge.from}`);
    }
    if (!nodeIds.has(edge.to)) {
      problems.push(`edge ${edge.id} points to missing node ${edge.to}`);
    }
    if (edge.count !== undefined && (!Number.isInteger(edge.count) || edge.count < 2)) {
      problems.push(`edge ${edge.id} has invalid count ${String(edge.count)}`);
    }
    if (edge.typeOnly !== undefined && edge.kind !== "imports") {
      problems.push(`edge ${edge.id} carries typeOnly on kind ${edge.kind}`);
    }
    if (edge.inCycle !== undefined && edge.kind !== "imports") {
      problems.push(`edge ${edge.id} carries inCycle on kind ${edge.kind}`);
    }
    if (edge.confidence !== undefined && edge.kind !== "calls") {
      problems.push(`edge ${edge.id} carries confidence on kind ${edge.kind}`);
    }
    if (edge.span) {
      problems.push(...spanProblems(edge.span, `edge ${edge.id}`));
    }
    if (edge.kind === "contains") {
      if (containsParent.has(edge.to)) {
        problems.push(`node ${edge.to} has multiple contains parents`);
      }
      containsParent.set(edge.to, edge.from);
    }
  }

  problems.push(...containmentCycleProblems(containsParent));
  return problems;
}

function spanProblems(span: SourceSpan, where: string): string[] {
  const problems: string[] = [];
  if (span.startLine < 1 || span.startCol < 1) {
    problems.push(`${where} has a span before 1:1`);
  }
  if (span.endLine < span.startLine) {
    problems.push(`${where} has a span ending before it starts`);
  }
  if (span.endLine === span.startLine && span.endCol < span.startCol) {
    problems.push(`${where} has a span ending before it starts`);
  }
  if (span.file.includes("\\")) {
    problems.push(`${where} has a span with backslashes in the path`);
  }
  return problems;
}

/** Containment must be a forest — walk each chain upward and detect loops. */
function containmentCycleProblems(parent: Map<string, string>): string[] {
  const problems: string[] = [];
  const cleared = new Set<string>();
  for (const start of parent.keys()) {
    const trail = new Set<string>();
    let current: string | undefined = start;
    while (current !== undefined && !cleared.has(current)) {
      if (trail.has(current)) {
        problems.push(`containment cycle through ${current}`);
        break;
      }
      trail.add(current);
      current = parent.get(current);
    }
    for (const id of trail) {
      cleared.add(id);
    }
  }
  return problems;
}
