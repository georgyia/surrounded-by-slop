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
  /** Unresolved-call sink name → node id, materialized on first use. */
  sinkFunctionIds: Map<string, string>;
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
    sinkFunctionIds: new Map(),
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

/**
 * Render a declaration's signature, preferring what the author actually wrote.
 *
 * The checker alone is not enough here (#149). `noLib` is deliberate — the core
 * touches no filesystem and analysis is byte-identical everywhere — but it
 * leaves `Array<T>` unresolved, so `checker.signatureToString` prints
 * `string[]` as `{}`. That does not read as "unknown", it reads as "returns an
 * empty object", which is a specific and wrong claim.
 *
 * So each part comes from its source annotation when the author wrote one, and
 * from the checker when they did not — which is exactly where inference is
 * still trustworthy.
 */
/**
 * The source text of a type annotation, unless the parse of it went wrong.
 *
 * In a file with syntax errors an annotation's text can be a truncated
 * fragment — `function broken(a: {` yields the text `{` — and printing that
 * would turn a partial graph into a malformed one. Balanced delimiters are a
 * cheap, honest test for "this is a whole type"; anything else defers to the
 * checker, which always produces something well-formed.
 */
function trustedTypeText(node: ts.TypeNode | undefined): string | undefined {
  if (node === undefined) {
    return undefined;
  }
  const text = node.getText();
  if (text === "") {
    return undefined;
  }
  const pairs: Record<string, string> = { "}": "{", "]": "[", ")": "(", ">": "<" };
  const open: string[] = [];
  for (const char of text) {
    if (char === "{" || char === "[" || char === "(") {
      open.push(char);
    } else if (char === "}" || char === "]" || char === ")") {
      if (open.pop() !== pairs[char]) {
        return undefined;
      }
    }
  }
  // Angle brackets are excluded from the stack: `<` also means "less than" in
  // a conditional or template type, so an imbalance there is not evidence.
  return open.length === 0 ? text : undefined;
}

export function signatureOf(
  ctx: ProjectContext,
  declaration: ts.SignatureDeclaration,
): string | undefined {
  const signature = ctx.checker.getSignatureFromDeclaration(declaration);
  if (signature === undefined) {
    return undefined;
  }
  const rendered = ctx.checker.signatureToString(signature);
  // Fast path: nothing was lost, so keep the checker's own formatting.
  if (!rendered.includes("{}")) {
    return rendered;
  }

  const typeParameters =
    declaration.typeParameters === undefined || declaration.typeParameters.length === 0
      ? ""
      : `<${declaration.typeParameters.map((parameter) => parameter.getText()).join(", ")}>`;

  const parameters = declaration.parameters.map((parameter) => {
    const rest = parameter.dotDotDotToken === undefined ? "" : "...";
    const optional = parameter.questionToken === undefined ? "" : "?";
    const name = parameter.name.getText();
    const written = trustedTypeText(parameter.type);
    const inferred = ctx.checker.typeToString(
      ctx.checker.getTypeAtLocation(parameter),
      parameter,
      ts.TypeFormatFlags.NoTruncation,
    );
    return `${rest}${name}${optional}: ${written ?? inferred}`;
  });

  const written = trustedTypeText(declaration.type);
  const inferredReturn = ctx.checker.typeToString(
    signature.getReturnType(),
    declaration,
    ts.TypeFormatFlags.NoTruncation,
  );
  // An author who wrote `{}` means it. An *inferred* `{}` is the unresolved
  // type again, so the return is left off rather than asserted wrongly — the
  // node's own kind already says it is a function.
  const returnType = written ?? (inferredReturn === "{}" ? undefined : inferredReturn);

  const head = `${typeParameters}(${parameters.join(", ")})`;
  return returnType === undefined ? head : `${head}: ${returnType}`;
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
