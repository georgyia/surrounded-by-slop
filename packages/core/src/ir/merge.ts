import { canonicalizeGraph } from "./ids.js";
import type { AnalysisResult } from "./types.js";

/**
 * Merge per-language analyses into one graph (#131).
 *
 * A project is analyzed one language at a time — each adapter sees only the
 * files it understands — and the results are merged here. Node ids are
 * path-based, so two adapters can never mint the same id for different things;
 * what they *can* share is an external package node, which is correct and
 * dedupes to one box.
 *
 * Pure, so both hosts merge identically: the extension's workspace map and the
 * CLI's `sbs map` of the same repo produce the same graph.
 */
export function mergeAnalyses(results: readonly AnalysisResult[]): AnalysisResult {
  const [first, ...rest] = results;
  if (first === undefined) {
    return { graph: { schemaVersion: 1, nodes: [], edges: [] }, diagnostics: [] };
  }
  if (rest.length === 0) {
    return first;
  }
  const seen = new Set<string>();
  const nodes = results
    .flatMap((result) => result.graph.nodes)
    .filter((node) => {
      if (seen.has(node.id)) {
        return false;
      }
      seen.add(node.id);
      return true;
    });
  const edgeIds = new Set<string>();
  const edges = results
    .flatMap((result) => result.graph.edges)
    .filter((edge) => {
      if (edgeIds.has(edge.id)) {
        return false;
      }
      edgeIds.add(edge.id);
      return true;
    });
  return {
    graph: canonicalizeGraph({ schemaVersion: first.graph.schemaVersion, nodes, edges }),
    diagnostics: results.flatMap((result) => result.diagnostics),
  };
}
