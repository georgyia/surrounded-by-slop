import type { Diagnostic, SourceSpan } from "../ir/types.js";

/**
 * Control-flow graph types — the optional per-function IR extension planned in
 * the spec (X-Ray milestone). A CFG lives *alongside* the Semantic Graph, so
 * adding it is not a schema break: same file, same spans, separate structure.
 *
 * Deliberate v1 limits (documented, not accidental):
 * - Expression-level control flow (`?:`, `&&`, `||`, `?.`) stays inside one
 *   block — only statements branch.
 * - Implicit exceptions are summarized as one `exception` edge from a try
 *   region's first block to its catch; explicit `throw` statements get precise
 *   edges.
 * - A `finally` joins every path routed through it: after re-routing, the
 *   finally's exit fans out to each recorded continuation.
 */

export type CfgBlockKind = "entry" | "exit" | "basic";

export interface CfgBlock {
  /** `entry`, `exit`, or `b1`…`bN` in source order. */
  id: string;
  kind: CfgBlockKind;
  /** One rendered line per statement, in execution order; empty for entry/exit. */
  statements: string[];
  /** Source span per statement (same order and length as `statements`). */
  spans: SourceSpan[];
  /** True when a statement in this block awaits (async is otherwise sequential). */
  awaits?: boolean;
}

export type CfgEdgeKind =
  /** Unconditional fall-through. */
  | "normal"
  /** Condition evaluated true / false. */
  | "true"
  | "false"
  /** Switch dispatch; `label` carries the case value, `default`, or `no match`. */
  | "case"
  /** Loop back-edge (styled distinctly by renderers). */
  | "back"
  /** Thrown control: into a catch, or out of the function. */
  | "exception"
  /** An early exit re-routed through a `finally`, and the finally's forwarding. */
  | "finally";

export interface CfgEdge {
  from: string;
  to: string;
  kind: CfgEdgeKind;
  /** Case edges only: the rendered case value(s). */
  label?: string;
}

export interface ControlFlowGraph {
  /** Display name: `place`, `OrderService.place`, `get total`, or `<anonymous>`. */
  name: string;
  /** The whole function, for cursor lookup (`cfgAtLine`) and reveal. */
  span: SourceSpan;
  entryId: string;
  exitId: string;
  blocks: CfgBlock[];
  edges: CfgEdge[];
}

/** What `extractControlFlow` returns for one file. */
export interface ExtractedControlFlow {
  /** One CFG per function-like with a body, in source order (nested included). */
  cfgs: ControlFlowGraph[];
  diagnostics: Diagnostic[];
}
