import type { GraphNode, SemanticGraph } from "@surrounded-by-slop/core";
import { rankNodes } from "@surrounded-by-slop/core";
import { estimateTokens } from "./tokens.js";

/**
 * The repo map (SBS-112): a ranked, token-budgeted skeleton of a codebase for AI
 * agents. Symbols are ordered by importance (`rankNodes`), grouped by file, and
 * cut to a token budget by binary search — the largest prefix of the ranking
 * that fits. Deterministic and free of timestamps or absolute paths, so a
 * committed map diffs cleanly (Rule 6).
 */

export interface RenderMapOptions {
  /** Token budget for the whole map. Default 2000. */
  budget?: number;
}

export interface RenderedMap {
  text: string;
  fileCount: number;
  shownSymbols: number;
  totalSymbols: number;
}

/** Short, readable kind tags for the map lines. */
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

/** A declaration worth listing: a real, in-file symbol, not a container or sink. */
function isListable(node: GraphNode): boolean {
  return (
    node.kind !== "module" &&
    node.kind !== "folder" &&
    node.external !== true &&
    node.span !== undefined
  );
}

interface MapSymbol {
  node: GraphNode;
  file: string;
  score: number;
  inbound: number;
}

function symbolLine(sym: MapSymbol): string {
  const label = KIND_LABEL[sym.node.kind];
  const signature = sym.node.signature ?? "";
  const line = sym.node.span?.startLine ?? 0;
  const inbound = sym.inbound > 0 ? ` ←${sym.inbound}` : "";
  return `  ${label} ${sym.node.name}${signature} ·${line}${inbound}`;
}

/**
 * Render the top `count` symbols, grouped by file. Files are ordered by their
 * best member; symbols within a file by score then source line.
 */
function renderTop(symbols: readonly MapSymbol[], count: number): { body: string; files: number } {
  const chosen = symbols.slice(0, count);
  const byFile = new Map<string, MapSymbol[]>();
  const fileBest = new Map<string, number>();
  for (const sym of chosen) {
    const bucket = byFile.get(sym.file) ?? [];
    bucket.push(sym);
    byFile.set(sym.file, bucket);
    fileBest.set(sym.file, Math.max(fileBest.get(sym.file) ?? 0, sym.score));
  }
  const files = [...byFile.keys()].sort((a, b) => {
    const best = (fileBest.get(b) ?? 0) - (fileBest.get(a) ?? 0);
    return best !== 0 ? best : a < b ? -1 : 1;
  });
  const blocks = files.map((file) => {
    const members = (byFile.get(file) ?? []).sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return (a.node.span?.startLine ?? 0) - (b.node.span?.startLine ?? 0);
    });
    return `${file}:\n${members.map(symbolLine).join("\n")}`;
  });
  return { body: blocks.join("\n"), files: files.length };
}

function header(fileCount: number, shown: number, total: number): string {
  return `# repo map · ${fileCount} files · ${shown}/${total} symbols · deeper: \`sbs query callers <name>\``;
}

export function renderMap(graph: SemanticGraph, options: RenderMapOptions = {}): RenderedMap {
  const budget = options.budget ?? 2000;

  // Inbound weight per node over calls + imports — the `←n` signal.
  const inbound = new Map<string, number>();
  for (const edge of graph.edges) {
    if (edge.kind !== "calls" && edge.kind !== "imports") {
      continue;
    }
    inbound.set(edge.to, (inbound.get(edge.to) ?? 0) + (edge.count ?? 1));
  }

  const scoreById = new Map(rankNodes(graph).map((ranked) => [ranked.id, ranked.score]));
  const symbols: MapSymbol[] = graph.nodes
    .filter(isListable)
    .map((node) => ({
      node,
      file: node.span?.file ?? node.qualifiedName,
      score: scoreById.get(node.id) ?? 0,
      inbound: inbound.get(node.id) ?? 0,
    }))
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.node.id < b.node.id ? -1 : 1));

  const total = symbols.length;
  if (total === 0) {
    return { text: `${header(0, 0, 0)}\n`, fileCount: 0, shownSymbols: 0, totalSymbols: 0 };
  }

  const build = (count: number): { text: string; files: number } => {
    const { body, files } = renderTop(symbols, count);
    // The header reports the final shown count; recomputed once we settle it.
    return { text: `${header(files, count, total)}\n${body}\n`, files };
  };

  // Largest prefix whose rendered map fits the budget (binary search).
  let low = 0;
  let high = total;
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    if (estimateTokens(build(mid).text) <= budget) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  // Always show at least the single most important symbol, even over budget, so
  // the map is never empty — the agent still learns the codebase's centre.
  const shown = Math.max(low, 1);
  const { text, files } = build(shown);
  return { text, fileCount: files, shownSymbols: shown, totalSymbols: total };
}
