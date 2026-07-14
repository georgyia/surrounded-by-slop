import type { CfgEdge, ControlFlowGraph } from "./types.js";

/**
 * Mermaid flowchart for a CFG (SBS-071) — the exact structure the interactive
 * view draws: same blocks, same edges, same condition labels. Kept separate
 * from the Semantic-Graph mermaid exporter because a CFG is not a graph of
 * declarations; it has its own vocabulary (branches, back edges, exceptions).
 */

/** Mermaid label escaping: quotes guard most syntax; double quotes become #quot;. */
function escapeLabel(text: string): string {
  return text.replaceAll('"', "#quot;");
}

function blockLabel(cfg: ControlFlowGraph, id: string): string | undefined {
  const block = cfg.blocks.find((candidate) => candidate.id === id);
  if (block === undefined) {
    return undefined;
  }
  if (block.kind === "entry") {
    return `${id}([Start])`;
  }
  if (block.kind === "exit") {
    return `${id}([End])`;
  }
  if (block.statements.length === 0) {
    // Statement-free join/latch blocks draw as small connector dots.
    return `${id}(( ))`;
  }
  const text = block.statements.join("<br/>");
  const awaits = block.awaits === true ? "⏳ " : "";
  // Blocks that branch (true/false/case out-edges) are decision diamonds.
  const branches = cfg.edges.some(
    (edge) =>
      edge.from === id && (edge.kind === "true" || edge.kind === "false" || edge.kind === "case"),
  );
  return branches
    ? `${id}{"${awaits}${escapeLabel(text)}"}`
    : `${id}["${awaits}${escapeLabel(text)}"]`;
}

function edgeLabel(edge: CfgEdge): string | undefined {
  switch (edge.kind) {
    case "true":
    case "false":
      return edge.kind;
    case "case":
      return edge.label;
    case "back":
      return "loop";
    case "exception":
      return "throws";
    case "finally":
      return "finally";
    default:
      return undefined;
  }
}

function arrow(edge: CfgEdge): string {
  // Dotted for the non-sequential kinds so the flowchart reads at a glance.
  return edge.kind === "back" || edge.kind === "exception" || edge.kind === "finally"
    ? "-.->"
    : "-->";
}

/** Render one CFG as a top-down Mermaid flowchart. */
export function cfgToMermaid(cfg: ControlFlowGraph): string {
  const lines: string[] = ["flowchart TD"];
  for (const block of cfg.blocks) {
    const label = blockLabel(cfg, block.id);
    if (label !== undefined) {
      lines.push(`  ${label}`);
    }
  }
  for (const edge of cfg.edges) {
    const label = edgeLabel(edge);
    const link = label === undefined ? arrow(edge) : `${arrow(edge)}|${escapeLabel(label)}|`;
    lines.push(`  ${edge.from} ${link} ${edge.to}`);
  }
  return `${lines.join("\n")}\n`;
}
