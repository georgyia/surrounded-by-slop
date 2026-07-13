import type { ControlFlowGraph, FunctionDataflow, SourceSpan } from "@surrounded-by-slop/core";

/**
 * Pure mapping from a variable's def-use sites to CFG blocks (SBS-072): which
 * blocks write it, which read it. The webview only toggles classes with this —
 * no re-layout, so switching variables is instant.
 */

export interface VariableHighlight {
  /** Blocks containing at least one write site. */
  readonly writes: ReadonlySet<string>;
  /** Blocks containing at least one read site (a block can be in both). */
  readonly reads: ReadonlySet<string>;
}

function within(site: SourceSpan, statement: SourceSpan): boolean {
  if (site.startLine < statement.startLine || site.endLine > statement.endLine) {
    return false;
  }
  if (site.startLine === statement.startLine && site.startCol < statement.startCol) {
    return false;
  }
  if (site.endLine === statement.endLine && site.endCol > statement.endCol) {
    return false;
  }
  return true;
}

function blocksTouching(cfg: ControlFlowGraph, sites: readonly SourceSpan[]): Set<string> {
  const hits = new Set<string>();
  for (const block of cfg.blocks) {
    if (block.spans.some((span) => sites.some((site) => within(site, span)))) {
      hits.add(block.id);
    }
  }
  return hits;
}

/** The blocks a variable flows through, by its id from the dataflow record. */
export function highlightForVariable(
  cfg: ControlFlowGraph,
  dataflow: FunctionDataflow,
  variableId: string,
): VariableHighlight | undefined {
  const variable = dataflow.variables.find((candidate) => candidate.id === variableId);
  if (variable === undefined) {
    return undefined;
  }
  return {
    writes: blocksTouching(cfg, variable.writes),
    reads: blocksTouching(cfg, variable.reads),
  };
}
