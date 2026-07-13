import type { CfgBlock, ControlFlowGraph } from "./types.js";

/**
 * Pure CFG queries with no compiler dependency. The webview bundles these
 * (reachability drives the unreachable badge, labels size the blocks), so this
 * module must never import `typescript` or the layout engine — keeping the
 * browser bundle at kilobytes instead of megabytes.
 */

/** Block ids reachable from the entry — the complement is unreachable code. */
export function reachableCfgBlocks(cfg: ControlFlowGraph): Set<string> {
  const successors = new Map<string, string[]>();
  for (const edge of cfg.edges) {
    const list = successors.get(edge.from) ?? [];
    list.push(edge.to);
    successors.set(edge.from, list);
  }
  const seen = new Set<string>([cfg.entryId]);
  const queue = [cfg.entryId];
  while (queue.length > 0) {
    const id = queue.pop() as string;
    for (const next of successors.get(id) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

/**
 * The one-line display label for a block, shared by the flowchart view and the
 * synthetic layout graph so boxes are always sized for exactly this text.
 */
export function cfgBlockLabel(block: CfgBlock): string {
  if (block.kind === "entry") {
    return "Start";
  }
  if (block.kind === "exit") {
    return "End";
  }
  const awaits = block.awaits === true ? "⏳ " : "";
  const more = block.statements.length > 1 ? " ⋯" : "";
  return `${awaits}${block.statements[0] ?? "·"}${more}`;
}
