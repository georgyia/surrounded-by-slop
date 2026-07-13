import ts from "typescript";
import type { FileInput } from "../adapter.js";
import type { Diagnostic, SourceSpan } from "../ir/types.js";
import { spanOf } from "../typescript/common.js";

/**
 * Per-function def-use analysis (SBS-072): where each variable is written and
 * read, resolved lexically with a hand-rolled scope stack (syntax-only, like
 * the CFG builder — fast enough for every keystroke).
 *
 * Documented precision limits (v1, deliberate):
 * - Lexical only: `var` hoisting and the TDZ are ignored — a use before its
 *   declaration line does not resolve. No `eval`, `with` or `arguments`.
 * - A nested function's accesses are recorded on the *nested* function, where
 *   the outer variable appears flagged `captured` — not on the declaring one.
 * - Module-level bindings are not variables of any function; references to
 *   them are out of scope here (the import graph already covers modules).
 * - Property accesses (`a.b`) read `a` only; `b` is not a variable.
 */

export interface VariableFlow {
  /** Declared name, e.g. `total`. */
  name: string;
  /** Stable per-function key: `name@line:col` of the declaration. */
  id: string;
  declarationSpan: SourceSpan;
  /** True when declared in an enclosing function and closed over here. */
  captured?: boolean;
  /** Assignment sites, the initializing declaration and parameter binding included. */
  writes: SourceSpan[];
  /** Value-read sites. A compound assignment (`x += 1`) is both. */
  reads: SourceSpan[];
}

export interface FunctionDataflow {
  /** Matches the CFG's `name`/`span` so the two line up per function. */
  name: string;
  span: SourceSpan;
  variables: VariableFlow[];
}

export interface ExtractedDataflow {
  functions: FunctionDataflow[];
  diagnostics: Diagnostic[];
}

type FunctionLike =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration
  | ts.ConstructorDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration;

function isFunctionLike(node: ts.Node): node is FunctionLike {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

/** One declared binding: where, and which function owns it (undefined = module). */
interface Binding {
  readonly span: SourceSpan;
  readonly owner: FunctionRecord | undefined;
  /** The flow entry on its owner, created eagerly at declaration. */
  readonly flow: VariableFlow | undefined;
}

interface FunctionRecord {
  readonly name: string;
  readonly span: SourceSpan;
  readonly variables: VariableFlow[];
  /** Captured entries by declaration key, so repeated uses merge. */
  readonly captured: Map<string, VariableFlow>;
}

function functionDisplayName(node: FunctionLike, sourceFile: ts.SourceFile): string {
  let className: string | undefined;
  let parent: ts.Node | undefined = node.parent;
  while (parent !== undefined) {
    if (ts.isClassLike(parent)) {
      className = parent.name?.text;
      break;
    }
    parent = parent.parent;
  }
  const qualify = (name: string): string =>
    className === undefined ? name : `${className}.${name}`;
  if (ts.isConstructorDeclaration(node)) {
    return qualify("constructor");
  }
  if (ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
    const prefix = ts.isGetAccessorDeclaration(node) ? "get" : "set";
    return qualify(`${prefix} ${node.name.getText(sourceFile)}`);
  }
  if (node.name !== undefined) {
    return qualify(node.name.getText(sourceFile));
  }
  const owner = node.parent;
  if (ts.isVariableDeclaration(owner) && ts.isIdentifier(owner.name)) {
    return owner.name.text;
  }
  if (ts.isPropertyAssignment(owner) && ts.isIdentifier(owner.name)) {
    return owner.name.text;
  }
  return "<anonymous>";
}

/** How an identifier participates in the expression around it. */
function accessKind(identifier: ts.Identifier): "read" | "write" | "readwrite" | "none" {
  const parent = identifier.parent;
  // `a.b` — b is a property name, not a variable reference.
  if (ts.isPropertyAccessExpression(parent) && parent.name === identifier) {
    return "none";
  }
  // `{ b: x } = …` destructuring key, `{ b: 1 }` literal key, labels, exports.
  if (
    (ts.isPropertyAssignment(parent) && parent.name === identifier) ||
    ts.isLabeledStatement(parent) ||
    ts.isBreakOrContinueStatement(parent) ||
    ts.isImportSpecifier(parent) ||
    ts.isExportSpecifier(parent)
  ) {
    return "none";
  }
  if (ts.isBinaryExpression(parent) && parent.left === identifier) {
    if (parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      return "write";
    }
    if (
      parent.operatorToken.kind >= ts.SyntaxKind.FirstCompoundAssignment &&
      parent.operatorToken.kind <= ts.SyntaxKind.LastCompoundAssignment
    ) {
      return "readwrite";
    }
  }
  if (
    (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) &&
    (parent.operator === ts.SyntaxKind.PlusPlusToken ||
      parent.operator === ts.SyntaxKind.MinusMinusToken)
  ) {
    return "readwrite";
  }
  // `for (x of …)` / `for (x in …)` assign into an existing binding.
  if (
    (ts.isForOfStatement(parent) || ts.isForInStatement(parent)) &&
    parent.initializer === identifier
  ) {
    return "write";
  }
  // `[x] = …` / `({ x } = …)` destructuring assignment targets.
  if (ts.isArrayLiteralExpression(parent) || ts.isShorthandPropertyAssignment(parent)) {
    let up: ts.Node = parent;
    while (
      ts.isArrayLiteralExpression(up.parent) ||
      ts.isObjectLiteralExpression(up.parent) ||
      ts.isPropertyAssignment(up.parent) ||
      ts.isShorthandPropertyAssignment(up.parent) ||
      ts.isSpreadElement(up.parent)
    ) {
      up = up.parent;
    }
    const context = up.parent;
    if (
      ts.isBinaryExpression(context) &&
      context.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      context.left === up
    ) {
      return "write";
    }
  }
  return "read";
}

/** Extract def-use flows for every function-like with a body in `file`. */
export function extractDataflow(file: FileInput): ExtractedDataflow {
  const sourceFile = ts.createSourceFile(
    file.path,
    file.text,
    ts.ScriptTarget.Latest,
    true,
    file.path.endsWith(".tsx") || file.path.endsWith(".jsx")
      ? ts.ScriptKind.TSX
      : file.path.endsWith(".js")
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS,
  );
  const functions: FunctionDataflow[] = [];
  const diagnostics: Diagnostic[] = [];

  const scopes: Map<string, Binding>[] = [new Map()]; // module scope at the bottom
  const functionStack: FunctionRecord[] = [];

  const declare = (nameNode: ts.Identifier, isWrite: boolean): void => {
    const owner = functionStack[functionStack.length - 1];
    const span = spanOf(nameNode, sourceFile);
    let flow: VariableFlow | undefined;
    if (owner !== undefined) {
      flow = {
        name: nameNode.text,
        id: `${nameNode.text}@${span.startLine}:${span.startCol}`,
        declarationSpan: span,
        writes: isWrite ? [span] : [],
        reads: [],
      };
      owner.variables.push(flow);
    }
    scopes[scopes.length - 1]?.set(nameNode.text, { span, owner, flow });
  };

  const declareBindingName = (name: ts.BindingName, isWrite: boolean): void => {
    if (ts.isIdentifier(name)) {
      declare(name, isWrite);
      return;
    }
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) {
        declareBindingName(element.name, isWrite);
      }
    }
  };

  const resolve = (name: string): Binding | undefined => {
    for (let at = scopes.length - 1; at >= 0; at -= 1) {
      const binding = scopes[at]?.get(name);
      if (binding !== undefined) {
        return binding;
      }
    }
    return undefined;
  };

  const reference = (identifier: ts.Identifier): void => {
    const current = functionStack[functionStack.length - 1];
    if (current === undefined) {
      return; // module-level expression — not any function's dataflow
    }
    const kind = accessKind(identifier);
    if (kind === "none") {
      return;
    }
    const binding = resolve(identifier.text);
    if (binding === undefined || binding.owner === undefined || binding.flow === undefined) {
      return; // unresolved or module-level — out of scope (documented)
    }
    const span = spanOf(identifier, sourceFile);
    let flow: VariableFlow;
    if (binding.owner === current) {
      flow = binding.flow;
    } else {
      // Closed-over variable: record on the *using* function, flagged captured.
      const key = `${binding.flow.name}@${binding.span.startLine}:${binding.span.startCol}`;
      let captured = current.captured.get(key);
      if (captured === undefined) {
        captured = {
          name: binding.flow.name,
          id: key,
          declarationSpan: binding.span,
          captured: true,
          writes: [],
          reads: [],
        };
        current.captured.set(key, captured);
        current.variables.push(captured);
      }
      flow = captured;
    }
    if (kind === "write" || kind === "readwrite") {
      flow.writes.push(span);
    }
    if (kind === "read" || kind === "readwrite") {
      flow.reads.push(span);
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isTypeNode(node)) {
      return; // type positions reference types, not runtime variables
    }
    if (isFunctionLike(node)) {
      // A named function declaration is itself a binding in the enclosing
      // scope — calling it later is a read of that binding.
      if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
        declare(node.name, true);
      }
      const record: FunctionRecord = {
        name: functionDisplayName(node, sourceFile),
        span: spanOf(node, sourceFile),
        variables: [],
        captured: new Map(),
      };
      functionStack.push(record);
      scopes.push(new Map());
      for (const parameter of node.parameters) {
        declareBindingName(parameter.name, true);
        if (parameter.initializer !== undefined) {
          visit(parameter.initializer); // `b = a` defaults read earlier params
        }
      }
      if (node.body !== undefined) {
        visit(node.body);
      }
      scopes.pop();
      functionStack.pop();
      if (node.body !== undefined) {
        functions.push({ name: record.name, span: record.span, variables: record.variables });
      }
      return;
    }
    if (ts.isBlock(node) || ts.isCaseBlock(node) || ts.isCatchClause(node)) {
      scopes.push(new Map());
      if (ts.isCatchClause(node) && node.variableDeclaration !== undefined) {
        declareBindingName(node.variableDeclaration.name, true);
      }
      node.forEachChild(visit);
      scopes.pop();
      return;
    }
    if (ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node)) {
      // The loop head introduces its own scope (per-iteration bindings).
      scopes.push(new Map());
      node.forEachChild(visit);
      scopes.pop();
      return;
    }
    if (ts.isVariableDeclaration(node)) {
      // Visit the initializer first: `const x = x` must resolve the old x.
      if (node.initializer !== undefined) {
        visit(node.initializer);
      }
      declareBindingName(node.name, node.initializer !== undefined || isLoopBinding(node));
      return;
    }
    if (ts.isIdentifier(node)) {
      reference(node);
      return;
    }
    node.forEachChild(visit);
  };

  const isLoopBinding = (declaration: ts.VariableDeclaration): boolean => {
    const list = declaration.parent;
    return (
      ts.isVariableDeclarationList(list) &&
      (ts.isForOfStatement(list.parent) || ts.isForInStatement(list.parent))
    );
  };

  try {
    visit(sourceFile);
  } catch (error) {
    diagnostics.push({
      severity: "error",
      message: `dataflow extraction failed: ${error instanceof Error ? error.message : String(error)}`,
      file: file.path,
    });
  }

  // Source order for functions and, within one, for each variable's sites.
  functions.sort(
    (a, b) => a.span.startLine - b.span.startLine || a.span.startCol - b.span.startCol,
  );
  const bySpan = (a: SourceSpan, b: SourceSpan): number =>
    a.startLine - b.startLine || a.startCol - b.startCol;
  for (const record of functions) {
    record.variables.sort((a, b) => bySpan(a.declarationSpan, b.declarationSpan));
    for (const variable of record.variables) {
      variable.reads.sort(bySpan);
      variable.writes.sort(bySpan);
    }
  }
  return { functions, diagnostics };
}

/** The dataflow record matching a CFG, aligned by function span. */
export function dataflowForSpan(
  flows: readonly FunctionDataflow[],
  span: SourceSpan,
): FunctionDataflow | undefined {
  return flows.find(
    (flow) => flow.span.startLine === span.startLine && flow.span.startCol === span.startCol,
  );
}
