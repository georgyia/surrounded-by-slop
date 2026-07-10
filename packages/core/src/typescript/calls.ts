import ts from "typescript";
import { unresolvedFunctionId } from "../ir/ids.js";
import { addEdge, type ProjectContext, spanOf } from "./common.js";
import { toRelativePath } from "./host.js";

/**
 * Calls phase: `calls` edges resolved through the type checker, so calls
 * through barrels and re-exports land on the implementation. The precision
 * rules (unresolved identifiers → low-confidence sink, unresolved property
 * callees omitted, function references as arguments → low confidence) are
 * normative in docs/ir-spec.md.
 */
export function collectFileCalls(ctx: ProjectContext, sourceFile: ts.SourceFile): void {
  const moduleNodeId = ctx.moduleIdByPath.get(toRelativePath(sourceFile.fileName));
  if (moduleNodeId === undefined) {
    return;
  }

  const callerStack: string[] = [moduleNodeId];
  const visit = (node: ts.Node): void => {
    const containerId = ctx.declToNodeId.get(node);
    if (containerId !== undefined) {
      callerStack.push(containerId);
    }
    if (ts.isCallExpression(node)) {
      handleCall(ctx, sourceFile, node, callerStack[callerStack.length - 1] ?? moduleNodeId);
    } else if (ts.isNewExpression(node)) {
      handleNew(ctx, sourceFile, node, callerStack[callerStack.length - 1] ?? moduleNodeId);
    }
    ts.forEachChild(node, visit);
    if (containerId !== undefined) {
      callerStack.pop();
    }
  };
  visit(sourceFile);
}

function handleCall(
  ctx: ProjectContext,
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
  callerId: string,
): void {
  const callee = call.expression;
  // import() and require() belong to the imports phase.
  if (callee.kind === ts.SyntaxKind.ImportKeyword) {
    return;
  }
  if (ts.isIdentifier(callee) && callee.text === "require") {
    return;
  }

  const targetId = resolveCallee(ctx, call);
  if (targetId !== undefined) {
    addEdge(ctx, "calls", callerId, targetId, { span: spanOf(call, sourceFile) });
  } else if (ts.isIdentifier(callee)) {
    addEdge(ctx, "calls", callerId, sinkFor(ctx, callee.text), {
      span: spanOf(call, sourceFile),
      confidence: "low",
    });
  }
  // Unresolved property callees (built-ins under noLib) are omitted by design.

  collectFunctionReferenceArguments(ctx, sourceFile, call, callerId);
}

function handleNew(
  ctx: ProjectContext,
  sourceFile: ts.SourceFile,
  expression: ts.NewExpression,
  callerId: string,
): void {
  const targetId = declarationTarget(ctx, expression.expression);
  if (targetId !== undefined) {
    addEdge(ctx, "calls", callerId, targetId, { span: spanOf(expression, sourceFile) });
  } else if (ts.isIdentifier(expression.expression)) {
    addEdge(ctx, "calls", callerId, sinkFor(ctx, expression.expression.text), {
      span: spanOf(expression, sourceFile),
      confidence: "low",
    });
  }
}

/** Resolution order: matched signature declaration first, callee symbol second. */
function resolveCallee(ctx: ProjectContext, call: ts.CallExpression): string | undefined {
  const signature = ctx.checker.getResolvedSignature(call);
  const declaration = signature?.declaration;
  if (declaration !== undefined && !ts.isJSDocSignature(declaration)) {
    const viaSignature = ctx.declToNodeId.get(declaration);
    if (viaSignature !== undefined) {
      return viaSignature;
    }
  }
  return declarationTarget(ctx, call.expression);
}

/** Maps an expression to a captured declaration's node id, unwrapping import aliases. */
function declarationTarget(ctx: ProjectContext, expression: ts.Expression): string | undefined {
  let symbol = ctx.checker.getSymbolAtLocation(expression);
  if (symbol === undefined) {
    return undefined;
  }
  if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    symbol = ctx.checker.getAliasedSymbol(symbol);
  }
  for (const declaration of symbol.declarations ?? []) {
    const targetId = ctx.declToNodeId.get(declaration);
    if (targetId !== undefined) {
      return targetId;
    }
  }
  return undefined;
}

/**
 * A function referenced (not called) as a call argument almost certainly gets
 * called by the callee — event handlers and callbacks earn a low-confidence
 * edge instead of vanishing from the diagram.
 */
function collectFunctionReferenceArguments(
  ctx: ProjectContext,
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
  callerId: string,
): void {
  for (const argument of call.arguments) {
    if (!ts.isIdentifier(argument)) {
      continue;
    }
    const targetId = declarationTarget(ctx, argument);
    if (targetId === undefined) {
      continue;
    }
    if (targetId.startsWith("function:") || targetId.startsWith("method:")) {
      addEdge(ctx, "calls", callerId, targetId, {
        span: spanOf(argument, sourceFile),
        confidence: "low",
      });
    }
  }
}

function sinkFor(ctx: ProjectContext, name: string): string {
  const existing = ctx.sinkFunctionIds.get(name);
  if (existing !== undefined) {
    return existing;
  }
  const id = unresolvedFunctionId(name);
  ctx.nodes.push({ id, kind: "function", name, qualifiedName: name, external: true });
  ctx.sinkFunctionIds.set(name, id);
  return id;
}
