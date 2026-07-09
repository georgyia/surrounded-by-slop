import ts from "typescript";
import { edgeId, IdAllocator } from "../ir/ids.js";
import type { Diagnostic, EdgeKind, GraphEdge, GraphNode, SourceSpan } from "../ir/types.js";
import { toRelativePath } from "./host.js";

/** Mutable state threaded through the analysis phases of one project run. */
export interface ProjectContext {
  program: ts.Program;
  checker: ts.TypeChecker;
  resolutionHost: ts.ModuleResolutionHost;
  ids: IdAllocator;
  nodes: GraphNode[];
  edges: GraphEdge[];
  diagnostics: Diagnostic[];
  /** Declaration → node id, across all files; how cross-file references land on nodes. */
  declToNodeId: Map<ts.Node, string>;
  /** Root-relative module path → module node id. */
  moduleIdByPath: Map<string, string>;
  /** External package name → node id, materialized on first use. */
  externalModuleIds: Map<string, string>;
  /** Heritage references resolved after every file's structure exists. */
  pendingHeritage: PendingHeritage[];
  /** Edge id → edge, so repeated (kind, from, to) occurrences merge with a count. */
  edgeById: Map<string, GraphEdge>;
}

export interface PendingHeritage {
  fromId: string;
  kind: "extends" | "implements";
  expression: ts.Expression;
}

export function createProjectContext(
  program: ts.Program,
  resolutionHost: ts.ModuleResolutionHost,
): ProjectContext {
  return {
    program,
    checker: program.getTypeChecker(),
    resolutionHost,
    ids: new IdAllocator(),
    nodes: [],
    edges: [],
    diagnostics: [],
    declToNodeId: new Map(),
    moduleIdByPath: new Map(),
    externalModuleIds: new Map(),
    pendingHeritage: [],
    edgeById: new Map(),
  };
}

export function spanOf(node: ts.Node, sourceFile: ts.SourceFile): SourceSpan {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
  return {
    file: toRelativePath(sourceFile.fileName),
    startLine: start.line + 1,
    startCol: start.character + 1,
    endLine: end.line + 1,
    endCol: end.character + 1,
  };
}

/** First line of the JSDoc comment, if any. */
export function docOf(node: ts.Node): string | undefined {
  const jsDoc = ts.getJSDocCommentsAndTags(node).find(ts.isJSDoc);
  if (!jsDoc || jsDoc.comment === undefined) {
    return undefined;
  }
  const text = ts.getTextOfJSDocComment(jsDoc.comment) ?? "";
  const firstLine = text.split("\n")[0]?.trim();
  return firstLine === "" ? undefined : firstLine;
}

export function signatureOf(
  ctx: ProjectContext,
  declaration: ts.SignatureDeclaration,
): string | undefined {
  const signature = ctx.checker.getSignatureFromDeclaration(declaration);
  return signature ? ctx.checker.signatureToString(signature) : undefined;
}

export interface EdgeProps {
  span?: SourceSpan | undefined;
  typeOnly?: boolean | undefined;
  confidence?: "low" | undefined;
}

/**
 * Adds an edge, merging repeated (kind, from, to) occurrences: `count`
 * accumulates, the first span wins, `typeOnly` survives only if every
 * occurrence is type-only, and one confident occurrence upgrades a
 * low-confidence edge.
 */
export function addEdge(
  ctx: ProjectContext,
  kind: EdgeKind,
  from: string,
  to: string,
  props: EdgeProps = {},
): void {
  const id = edgeId(kind, from, to);
  const existing = ctx.edgeById.get(id);
  if (existing) {
    existing.count = (existing.count ?? 1) + 1;
    if (existing.typeOnly && !props.typeOnly) {
      delete existing.typeOnly;
    }
    if (existing.confidence === "low" && props.confidence === undefined) {
      delete existing.confidence;
    }
    return;
  }
  const edge: GraphEdge = { id, kind, from, to };
  if (props.span) {
    edge.span = props.span;
  }
  if (props.typeOnly) {
    edge.typeOnly = true;
  }
  if (props.confidence) {
    edge.confidence = props.confidence;
  }
  ctx.edgeById.set(id, edge);
  ctx.edges.push(edge);
}
