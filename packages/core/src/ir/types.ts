/**
 * The Semantic Graph IR — the contract of this project.
 *
 * Language adapters produce it; exporters, transforms and the webview consume
 * it and nothing else (never ASTs). The full specification, including the id
 * grammar, capture rules and deliberate v1 limits, lives in `docs/ir-spec.md`.
 */

export const SCHEMA_VERSION = 1;

export type NodeKind =
  | "module"
  | "namespace"
  | "class"
  | "interface"
  | "enum"
  | "function"
  | "method"
  | "variable"
  /** Produced only by collapse transforms, never by adapters. */
  | "folder";

export type EdgeKind =
  | "contains"
  | "imports"
  | "calls"
  | "extends"
  | "implements"
  /** Reserved for the data-flow milestone; no adapter emits them yet. */
  | "reads"
  | "writes";

/** A source location. Lines and columns are 1-based; `file` is root-relative with forward slashes. */
export interface SourceSpan {
  file: string;
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

export interface GraphNode {
  /** Stable, human-readable id — see the id grammar in the spec. */
  id: string;
  kind: NodeKind;
  /** Local display name, e.g. `inner`. */
  name: string;
  /** Dot-qualified name within its module, e.g. `outer.inner`; the module path for modules. */
  qualifiedName: string;
  /** Absent for external and synthesized nodes. */
  span?: SourceSpan;
  /** True when the declaration is exported from its module. */
  exported?: boolean;
  /** True for nodes outside the analyzed project (npm packages, unresolved sinks). */
  external?: boolean;
  /** Checker-rendered signature for functions and methods. */
  signature?: string;
  /** First line of the doc comment, if any. */
  doc?: string;
}

export interface GraphEdge {
  /** Derived id: `kind:from->to`. */
  id: string;
  kind: EdgeKind;
  from: string;
  to: string;
  /** Site of the first occurrence (e.g. first call site). */
  span?: SourceSpan;
  /** Number of merged occurrences; present only when greater than 1. */
  count?: number;
  /** Imports only: every merged occurrence is type-only. */
  typeOnly?: boolean;
  /** Calls only: heuristic edge (unresolved callee, callback reference). */
  confidence?: "low";
  /** Imports only: the edge participates in a module cycle. */
  inCycle?: boolean;
}

export interface Diagnostic {
  severity: "error" | "warning" | "info";
  message: string;
  file?: string;
}

/**
 * A semantic graph in canonical form: nodes and edges sorted by id.
 * Serialize with `stableStringify` — never with bare `JSON.stringify`.
 */
export interface SemanticGraph {
  schemaVersion: typeof SCHEMA_VERSION;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** What an analysis returns: the graph plus everything worth telling the user. */
export interface AnalysisResult {
  graph: SemanticGraph;
  diagnostics: Diagnostic[];
}
