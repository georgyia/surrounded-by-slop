import ts from "typescript";
import { declarationId, moduleId } from "../ir/ids.js";
import type { GraphNode, NodeKind } from "../ir/types.js";
import { addEdge, docOf, type ProjectContext, signatureOf, spanOf } from "./common.js";
import { toRelativePath } from "./host.js";

/**
 * Structure phase: declarations and containment for one source file.
 * Capture rules are normative in docs/ir-spec.md — anonymous inline callbacks
 * are deliberately not nodes; their contents attribute to the nearest
 * captured container.
 */

interface Container {
  id: string;
  /** Dot-joined qualification below the module; empty at module level. */
  prefix: string;
}

interface FileState {
  ctx: ProjectContext;
  sourceFile: ts.SourceFile;
  relativePath: string;
  /** Names exported via `export { x }` lists or `export default x`. */
  exportedNames: Set<string>;
  /** Module-level nodes, revisited once exportedNames is complete. */
  moduleLevel: { node: GraphNode; name: string }[];
  /** Same-parent same-name function declarations (overloads) share one node. */
  functionNodeByParent: Map<ts.Node, Map<string, string>>;
}

export function collectFileStructure(ctx: ProjectContext, sourceFile: ts.SourceFile): string {
  const relativePath = toRelativePath(sourceFile.fileName);
  for (const diagnostic of ctx.program.getSyntacticDiagnostics(sourceFile)) {
    ctx.diagnostics.push({
      severity: "error",
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
      file: relativePath,
    });
  }

  const moduleNodeId = moduleId(relativePath);
  ctx.nodes.push({
    id: moduleNodeId,
    kind: "module",
    name: relativePath,
    qualifiedName: relativePath,
    span: spanOf(sourceFile, sourceFile),
  });
  ctx.moduleIdByPath.set(relativePath, moduleNodeId);

  const state: FileState = {
    ctx,
    sourceFile,
    relativePath,
    exportedNames: collectExportedNames(sourceFile),
    moduleLevel: [],
    functionNodeByParent: new Map(),
  };
  const moduleContainer: Container = { id: moduleNodeId, prefix: "" };
  for (const statement of sourceFile.statements) {
    collect(state, statement, moduleContainer);
  }
  for (const { node, name } of state.moduleLevel) {
    if (state.exportedNames.has(name)) {
      node.exported = true;
    }
  }
  return moduleNodeId;
}

/** `export { a, b as c }` marks locals a and b; `export default x` marks x. */
function collectExportedNames(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier === undefined &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        names.add((element.propertyName ?? element.name).text);
      }
    }
    if (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression)) {
      names.add(statement.expression.text);
    }
  }
  return names;
}

function collect(state: FileState, node: ts.Node, container: Container): void {
  if (ts.isFunctionDeclaration(node)) {
    collectFunctionDeclaration(state, node, container);
    return;
  }
  if (ts.isVariableStatement(node)) {
    collectVariableStatement(state, node, container);
    return;
  }
  if (ts.isClassDeclaration(node)) {
    collectClassLike(state, node, container, node.name?.text ?? "default");
    return;
  }
  if (ts.isInterfaceDeclaration(node)) {
    const id = addDeclaration(state, container, "interface", node.name.text, node);
    collectHeritage(state, node, id, "extends");
    return;
  }
  if (ts.isEnumDeclaration(node)) {
    addDeclaration(state, container, "enum", node.name.text, node);
    return;
  }
  if (ts.isModuleDeclaration(node) && ts.isIdentifier(node.name) && node.body !== undefined) {
    const id = addDeclaration(state, container, "namespace", node.name.text, node);
    const inner: Container = { id, prefix: qualifiedNameOf(container, node.name.text) };
    if (ts.isModuleBlock(node.body)) {
      for (const statement of node.body.statements) {
        collect(state, statement, inner);
      }
    } else {
      collect(state, node.body, inner);
    }
    return;
  }
  if (ts.isExportAssignment(node) && !node.isExportEquals) {
    collectDefaultExportExpression(state, node.expression, container);
    return;
  }
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    return; // the imports phase reads these
  }
  ts.forEachChild(node, (child) => {
    collect(state, child, container);
  });
}

function collectFunctionDeclaration(
  state: FileState,
  node: ts.FunctionDeclaration,
  container: Container,
): void {
  const name = node.name?.text ?? "default";
  const parent = node.parent;
  let byName = state.functionNodeByParent.get(parent);
  if (byName === undefined) {
    byName = new Map();
    state.functionNodeByParent.set(parent, byName);
  }
  let id = byName.get(name);
  if (id === undefined) {
    id = addDeclaration(state, container, "function", name, node);
    byName.set(name, id);
  } else {
    // Overload signature or implementation of an already-seen declaration.
    state.ctx.declToNodeId.set(node, id);
  }
  if (node.body) {
    collectBody(state, node.body, { id, prefix: qualifiedNameOf(container, name) });
  }
}

function collectVariableStatement(
  state: FileState,
  node: ts.VariableStatement,
  container: Container,
): void {
  const exported = hasExportModifier(node);
  for (const declaration of node.declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name)) {
      continue; // destructuring declarations are a documented v1 limit
    }
    const name = declaration.name.text;
    const initializer = declaration.initializer;
    if (
      initializer !== undefined &&
      (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
    ) {
      const id = addDeclaration(state, container, "function", name, declaration, {
        signatureFrom: initializer,
        exported,
      });
      state.ctx.declToNodeId.set(initializer, id);
      collectBody(state, initializer.body, { id, prefix: qualifiedNameOf(container, name) });
    } else if (exported || (container.prefix === "" && state.exportedNames.has(name))) {
      // Export via modifier or via an `export { name }` list further down.
      addDeclaration(state, container, "variable", name, declaration, { exported });
    }
  }
}

function collectClassLike(
  state: FileState,
  node: ts.ClassDeclaration | ts.ClassExpression,
  container: Container,
  name: string,
  forceExported = false,
): void {
  const id = addDeclaration(state, container, "class", name, node, {
    exported: forceExported || undefined,
  });
  collectHeritage(state, node, id, "extends");
  const classContainer: Container = { id, prefix: qualifiedNameOf(container, name) };
  for (const member of node.members) {
    collectClassMember(state, member, classContainer);
  }
}

function collectClassMember(state: FileState, member: ts.ClassElement, container: Container): void {
  if (ts.isConstructorDeclaration(member)) {
    const id = memberNode(state, member, container, "constructor", member);
    if (member.body) {
      collectBody(state, member.body, { id, prefix: qualifiedNameOf(container, "constructor") });
    }
    return;
  }
  if (
    ts.isMethodDeclaration(member) ||
    ts.isGetAccessorDeclaration(member) ||
    ts.isSetAccessorDeclaration(member)
  ) {
    const name = propertyName(member.name, state.sourceFile);
    const id = memberNode(state, member, container, name, member);
    if (member.body) {
      collectBody(state, member.body, { id, prefix: qualifiedNameOf(container, name) });
    }
    return;
  }
  if (
    ts.isPropertyDeclaration(member) &&
    member.initializer !== undefined &&
    (ts.isArrowFunction(member.initializer) || ts.isFunctionExpression(member.initializer))
  ) {
    const name = propertyName(member.name, state.sourceFile);
    const id = memberNode(state, member, container, name, member.initializer);
    state.ctx.declToNodeId.set(member.initializer, id);
    collectBody(state, member.initializer.body, {
      id,
      prefix: qualifiedNameOf(container, name),
    });
  }
}

function memberNode(
  state: FileState,
  member: ts.ClassElement,
  container: Container,
  name: string,
  signatureFrom: ts.Node,
): string {
  // Overloaded methods share a node, like overloaded functions.
  const parent = member.parent;
  let byName = state.functionNodeByParent.get(parent);
  if (byName === undefined) {
    byName = new Map();
    state.functionNodeByParent.set(parent, byName);
  }
  const overloadKey = `method ${name}`;
  const existing = ts.isMethodDeclaration(member) ? byName.get(overloadKey) : undefined;
  if (existing !== undefined) {
    state.ctx.declToNodeId.set(member, existing);
    return existing;
  }
  const id = addDeclaration(state, container, "method", name, member, {
    signatureFrom: ts.isFunctionLike(signatureFrom) ? signatureFrom : undefined,
  });
  if (ts.isMethodDeclaration(member)) {
    byName.set(overloadKey, id);
  }
  return id;
}

function collectDefaultExportExpression(
  state: FileState,
  expression: ts.Expression,
  container: Container,
): void {
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
    const name =
      ts.isFunctionExpression(expression) && expression.name ? expression.name.text : "default";
    const id = addDeclaration(state, container, "function", name, expression, {
      signatureFrom: expression,
      exported: true,
    });
    collectBody(state, expression.body, { id, prefix: qualifiedNameOf(container, name) });
    return;
  }
  if (ts.isClassExpression(expression)) {
    collectClassLike(state, expression, container, expression.name?.text ?? "default", true);
  }
  // `export default someIdentifier` is handled via exportedNames;
  // `export default <other expression>` creates no node (documented limit).
}

/** Walks a captured body, attributing nested declarations to `container`. */
function collectBody(state: FileState, body: ts.Node, container: Container): void {
  ts.forEachChild(body, (child) => {
    collect(state, child, container);
  });
}

interface DeclarationExtras {
  signatureFrom?: ts.SignatureDeclaration | ts.Node | undefined;
  exported?: boolean | undefined;
}

function addDeclaration(
  state: FileState,
  container: Container,
  kind: NodeKind,
  name: string,
  declaration: ts.Node,
  extras: DeclarationExtras = {},
): string {
  const { ctx } = state;
  const qualifiedName = qualifiedNameOf(container, name);
  const id = ctx.ids.allocate(declarationId(kind, state.relativePath, qualifiedName));

  const signatureSource =
    extras.signatureFrom !== undefined ? extras.signatureFrom : (declaration as ts.Node);
  const signature =
    (kind === "function" || kind === "method") && ts.isFunctionLike(signatureSource)
      ? signatureOf(ctx, signatureSource)
      : undefined;

  const node: GraphNode = {
    id,
    kind,
    name,
    qualifiedName,
    span: spanOf(declaration, state.sourceFile),
  };
  if (extras.exported === true || hasExportModifier(declaration)) {
    node.exported = true;
  }
  if (signature !== undefined) {
    node.signature = signature;
  }
  const doc = docOf(declaration);
  if (doc !== undefined) {
    node.doc = doc;
  }
  ctx.nodes.push(node);
  ctx.declToNodeId.set(declaration, id);
  addEdge(ctx, "contains", container.id, id);
  if (container.prefix === "") {
    state.moduleLevel.push({ node, name });
  }
  return id;
}

function collectHeritage(
  state: FileState,
  node: ts.ClassDeclaration | ts.ClassExpression | ts.InterfaceDeclaration,
  fromId: string,
  defaultKind: "extends" | "implements",
): void {
  for (const clause of node.heritageClauses ?? []) {
    const kind = clause.token === ts.SyntaxKind.ImplementsKeyword ? "implements" : defaultKind;
    for (const type of clause.types) {
      state.ctx.pendingHeritage.push({ fromId, kind, expression: type.expression });
    }
  }
}

/** Resolves heritage references once every file's declarations exist. */
export function resolveHeritage(ctx: ProjectContext): void {
  for (const pending of ctx.pendingHeritage) {
    let symbol = ctx.checker.getSymbolAtLocation(pending.expression);
    if (symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0) {
      symbol = ctx.checker.getAliasedSymbol(symbol);
    }
    for (const declaration of symbol?.declarations ?? []) {
      const targetId = ctx.declToNodeId.get(declaration);
      if (targetId !== undefined) {
        addEdge(ctx, pending.kind, pending.fromId, targetId, {
          span: spanOf(pending.expression, pending.expression.getSourceFile()),
        });
        break;
      }
    }
  }
  ctx.pendingHeritage.length = 0;
}

function qualifiedNameOf(container: Container, name: string): string {
  return container.prefix === "" ? name : `${container.prefix}.${name}`;
}

function hasExportModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) {
    return false;
  }
  return (
    ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ??
    false
  );
}

function propertyName(name: ts.PropertyName, sourceFile: ts.SourceFile): string {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  if (ts.isPrivateIdentifier(name)) {
    return name.text;
  }
  return name.getText(sourceFile);
}
