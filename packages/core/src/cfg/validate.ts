import type { ControlFlowGraph } from "./types.js";

/**
 * Structural validation for a CFG, mirroring `validateGraph` for the Semantic
 * Graph: every fixture and every runtime extraction must pass with zero
 * problems. Returns human-readable problems, empty when valid.
 */
export function validateCfg(cfg: ControlFlowGraph): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  let entries = 0;
  let exits = 0;

  for (const block of cfg.blocks) {
    if (ids.has(block.id)) {
      problems.push(`duplicate block id ${block.id}`);
    }
    ids.add(block.id);
    if (block.kind === "entry") {
      entries += 1;
    }
    if (block.kind === "exit") {
      exits += 1;
    }
    if (block.statements.length !== block.spans.length) {
      problems.push(
        `block ${block.id} has ${block.statements.length} statements but ${block.spans.length} spans`,
      );
    }
    if (block.kind !== "basic" && block.statements.length > 0) {
      problems.push(`${block.kind} block ${block.id} must be empty`);
    }
    for (const span of block.spans) {
      const ordered =
        span.startLine < span.endLine ||
        (span.startLine === span.endLine && span.startCol <= span.endCol);
      if (!ordered) {
        problems.push(
          `block ${block.id} has an inverted span (${span.startLine}:${span.startCol})`,
        );
      }
      const inside = span.startLine >= cfg.span.startLine && span.endLine <= cfg.span.endLine;
      if (!inside) {
        problems.push(`block ${block.id} maps outside its function (${span.startLine})`);
      }
    }
  }
  if (entries !== 1) {
    problems.push(`expected exactly one entry block, found ${entries}`);
  }
  if (exits !== 1) {
    problems.push(`expected exactly one exit block, found ${exits}`);
  }
  if (!ids.has(cfg.entryId)) {
    problems.push(`entryId ${cfg.entryId} is not a block`);
  }
  if (!ids.has(cfg.exitId)) {
    problems.push(`exitId ${cfg.exitId} is not a block`);
  }

  const seenEdges = new Set<string>();
  for (const edge of cfg.edges) {
    if (!ids.has(edge.from)) {
      problems.push(`edge from unknown block ${edge.from}`);
    }
    if (!ids.has(edge.to)) {
      problems.push(`edge to unknown block ${edge.to}`);
    }
    if (edge.to === cfg.entryId) {
      problems.push("entry block has an incoming edge");
    }
    if (edge.from === cfg.exitId) {
      problems.push("exit block has an outgoing edge");
    }
    const key = `${edge.from}→${edge.to}:${edge.kind}:${edge.label ?? ""}`;
    if (seenEdges.has(key)) {
      problems.push(`duplicate edge ${key}`);
    }
    seenEdges.add(key);
    if (edge.label !== undefined && edge.kind !== "case") {
      problems.push(`edge ${key} carries a label but is not a case edge`);
    }
  }
  return problems;
}
