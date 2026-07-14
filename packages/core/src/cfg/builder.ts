import ts from "typescript";
import type { FileInput } from "../adapter.js";
import type { Diagnostic, SourceSpan } from "../ir/types.js";
import { spanOf } from "../typescript/common.js";
import type {
  CfgBlock,
  CfgEdge,
  CfgEdgeKind,
  ControlFlowGraph,
  ExtractedControlFlow,
} from "./types.js";

/**
 * Per-function control-flow graphs (SBS-070). Syntax-only — a standalone
 * SourceFile, no type checker — so extraction stays fast enough to run on
 * every cursor move. See `types.ts` for the deliberate v1 precision limits.
 *
 * The builder is the classic single-pass shape: statements accumulate into a
 * `current` block; control constructs cut blocks and add typed edges; a frame
 * stack resolves `break`/`continue`/`throw`/`return` targets, re-routing
 * through enclosing `finally` bodies where the language demands it.
 */

const MAX_LABEL_LENGTH = 60;

/** An abstract jump, replayed from a finally's end once its body is built. */
type Jump =
  | { readonly type: "return" }
  | { readonly type: "throw" }
  | { readonly type: "break"; readonly label: string | undefined }
  | { readonly type: "continue"; readonly label: string | undefined };

type Frame =
  | {
      readonly kind: "loop";
      readonly label: string | undefined;
      readonly breakTarget: CfgBlock;
      readonly continueTarget: CfgBlock;
    }
  | { readonly kind: "switch"; readonly breakTarget: CfgBlock }
  | { readonly kind: "label"; readonly label: string; readonly breakTarget: CfgBlock }
  | { readonly kind: "catch"; readonly entry: CfgBlock }
  | { readonly kind: "finally"; readonly entry: CfgBlock; readonly pending: Jump[] };

function firstLine(text: string): string {
  const line = (text.split("\n", 1)[0] ?? "").trim().replace(/\s+/g, " ");
  return line.length > MAX_LABEL_LENGTH ? `${line.slice(0, MAX_LABEL_LENGTH - 1)}…` : line;
}

/** Function-likes bound their own control flow — the walk never crosses them. */
function isFlowBoundary(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isClassLike(node)
  );
}

/** Does this statement await anything of its own (nested functions excluded)? */
function containsAwait(node: ts.Node): boolean {
  if (ts.isAwaitExpression(node)) {
    return true;
  }
  if (ts.isForOfStatement(node) && node.awaitModifier !== undefined) {
    return true;
  }
  let found = false;
  const visit = (child: ts.Node): void => {
    if (found || isFlowBoundary(child)) {
      return;
    }
    if (ts.isAwaitExpression(child) || (ts.isForOfStatement(child) && child.awaitModifier)) {
      found = true;
      return;
    }
    child.forEachChild(visit);
  };
  node.forEachChild(visit);
  return found;
}

class FunctionCfgBuilder {
  private readonly blocks: CfgBlock[] = [];
  private readonly edges: CfgEdge[] = [];
  private readonly entry: CfgBlock;
  private readonly exit: CfgBlock;
  private current: CfgBlock | undefined;
  private readonly stack: Frame[] = [];
  /** A label waiting to attach to the next loop, e.g. `outer: for (…)`. */
  private pendingLoopLabel: string | undefined;

  constructor(private readonly sourceFile: ts.SourceFile) {
    this.entry = this.newBlock("entry");
    this.exit = this.newBlock("exit");
    this.current = this.newBlock();
    this.edge(this.entry, this.current, "normal");
  }

  build(body: ts.ConciseBody): void {
    if (ts.isBlock(body)) {
      for (const statement of body.statements) {
        this.statement(statement);
      }
    } else {
      // Arrow expression body: one implicit `return expr`.
      this.addText(body, firstLine(body.getText(this.sourceFile)));
      this.jump({ type: "return" });
    }
    if (this.current !== undefined) {
      this.edge(this.current, this.exit, "normal");
    }
  }

  finish(name: string, span: SourceSpan): ControlFlowGraph {
    this.simplify();
    // Stable ids: entry, then surviving basics in creation order, exit last.
    const basics = this.blocks.filter((block) => block.kind === "basic");
    const ordered = [this.entry, ...basics, this.exit];
    const rename = new Map<string, string>();
    const position = new Map<string, number>();
    ordered.forEach((block, at) => {
      const id = block.kind === "entry" ? "entry" : block.kind === "exit" ? "exit" : `b${at}`;
      rename.set(block.id, id);
      position.set(id, at);
    });
    const at = (id: string): number => position.get(id) ?? Number.MAX_SAFE_INTEGER;
    const finalEdges = this.edges
      .map((edge) => ({
        ...edge,
        from: rename.get(edge.from) ?? edge.from,
        to: rename.get(edge.to) ?? edge.to,
      }))
      .sort(
        (a, b) => at(a.from) - at(b.from) || at(a.to) - at(b.to) || a.kind.localeCompare(b.kind),
      );
    for (const block of ordered) {
      block.id = rename.get(block.id) ?? block.id;
    }
    return {
      name,
      span,
      entryId: "entry",
      exitId: "exit",
      blocks: ordered,
      edges: finalEdges,
    };
  }

  // ---- construction primitives ----

  private newBlock(kind: "entry" | "exit" | "basic" = "basic"): CfgBlock {
    const block: CfgBlock = {
      id: `t${this.blocks.length}`, // temporary; renamed in finish()
      kind,
      statements: [],
      spans: [],
    };
    this.blocks.push(block);
    return block;
  }

  private edge(from: CfgBlock, to: CfgBlock, kind: CfgEdgeKind, label?: string): void {
    const exists = this.edges.some(
      (edge) => edge.from === from.id && edge.to === to.id && edge.kind === kind,
    );
    if (!exists) {
      this.edges.push(
        label === undefined
          ? { from: from.id, to: to.id, kind }
          : { from: from.id, to: to.id, kind, label },
      );
    }
  }

  private ensureCurrent(): CfgBlock {
    if (this.current === undefined) {
      // Fresh block with no incoming edges — exactly how unreachable code
      // (statements after a return/throw/break) shows up in the graph.
      this.current = this.newBlock();
    }
    return this.current;
  }

  private addText(node: ts.Node, text: string): void {
    const block = this.ensureCurrent();
    block.statements.push(text);
    block.spans.push(spanOf(node, this.sourceFile));
    if (containsAwait(node)) {
      block.awaits = true;
    }
  }

  /** Route an abstract jump from `current` through any finallies to its target. */
  private jump(jump: Jump): void {
    const from = this.ensureCurrent();
    this.performJump(from, jump);
    this.current = undefined;
  }

  private performJump(from: CfgBlock, jump: Jump): void {
    for (let at = this.stack.length - 1; at >= 0; at -= 1) {
      const frame = this.stack[at];
      if (frame === undefined) {
        continue;
      }
      if (frame.kind === "finally") {
        this.edge(from, frame.entry, "finally");
        frame.pending.push(jump);
        return;
      }
      if (frame.kind === "catch" && jump.type === "throw") {
        this.edge(from, frame.entry, "exception");
        return;
      }
      if (jump.type === "break") {
        if (
          (frame.kind === "loop" && (jump.label === undefined || frame.label === jump.label)) ||
          (frame.kind === "switch" && jump.label === undefined) ||
          (frame.kind === "label" && frame.label === jump.label)
        ) {
          this.edge(from, frame.breakTarget, "normal");
          return;
        }
      }
      if (
        jump.type === "continue" &&
        frame.kind === "loop" &&
        (jump.label === undefined || frame.label === jump.label)
      ) {
        this.edge(from, frame.continueTarget, "back");
        return;
      }
    }
    // Fell off the stack: return ends the function; throw leaves it uncaught.
    this.edge(from, this.exit, jump.type === "throw" ? "exception" : "normal");
  }

  private takeLoopLabel(): string | undefined {
    const label = this.pendingLoopLabel;
    this.pendingLoopLabel = undefined;
    return label;
  }

  // ---- statements ----

  private statement(stmt: ts.Statement): void {
    if (ts.isBlock(stmt)) {
      for (const inner of stmt.statements) {
        this.statement(inner);
      }
      return;
    }
    if (ts.isIfStatement(stmt)) {
      this.ifStatement(stmt);
      return;
    }
    if (ts.isWhileStatement(stmt)) {
      this.whileStatement(stmt);
      return;
    }
    if (ts.isDoStatement(stmt)) {
      this.doStatement(stmt);
      return;
    }
    if (ts.isForStatement(stmt)) {
      this.forStatement(stmt);
      return;
    }
    if (ts.isForOfStatement(stmt) || ts.isForInStatement(stmt)) {
      this.forEachStatement(stmt);
      return;
    }
    if (ts.isSwitchStatement(stmt)) {
      this.switchStatement(stmt);
      return;
    }
    if (ts.isTryStatement(stmt)) {
      this.tryStatement(stmt);
      return;
    }
    if (ts.isLabeledStatement(stmt)) {
      this.labeledStatement(stmt);
      return;
    }
    if (ts.isReturnStatement(stmt)) {
      this.addText(stmt, firstLine(stmt.getText(this.sourceFile)));
      this.jump({ type: "return" });
      return;
    }
    if (ts.isThrowStatement(stmt)) {
      this.addText(stmt, firstLine(stmt.getText(this.sourceFile)));
      this.jump({ type: "throw" });
      return;
    }
    if (ts.isBreakStatement(stmt)) {
      this.addText(stmt, firstLine(stmt.getText(this.sourceFile)));
      this.jump({ type: "break", label: stmt.label?.text });
      return;
    }
    if (ts.isContinueStatement(stmt)) {
      this.addText(stmt, firstLine(stmt.getText(this.sourceFile)));
      this.jump({ type: "continue", label: stmt.label?.text });
      return;
    }
    if (ts.isEmptyStatement(stmt)) {
      return;
    }
    // Everything else — expressions, declarations, nested functions/classes —
    // is one sequential step. Nested bodies become their own CFGs elsewhere.
    this.addText(stmt, firstLine(stmt.getText(this.sourceFile)));
  }

  /** Cut the block so a condition/dispatch starts fresh: branches must visibly
   * leave a box whose label *is* the condition, not preceding statements. */
  private startConditionBlock(): void {
    if (this.current !== undefined && this.current.statements.length > 0) {
      const condition = this.newBlock();
      this.edge(this.current, condition, "normal");
      this.current = condition;
    }
  }

  private ifStatement(stmt: ts.IfStatement): void {
    this.startConditionBlock();
    this.addText(stmt.expression, firstLine(stmt.expression.getText(this.sourceFile)));
    const condition = this.ensureCurrent();
    const after = this.newBlock();

    this.current = this.newBlock();
    this.edge(condition, this.current, "true");
    this.statement(stmt.thenStatement);
    if (this.current !== undefined) {
      this.edge(this.current, after, "normal");
    }

    if (stmt.elseStatement === undefined) {
      this.edge(condition, after, "false");
    } else {
      this.current = this.newBlock();
      this.edge(condition, this.current, "false");
      this.statement(stmt.elseStatement);
      if (this.current !== undefined) {
        this.edge(this.current, after, "normal");
      }
    }
    this.current = after;
  }

  private whileStatement(stmt: ts.WhileStatement): void {
    const label = this.takeLoopLabel();
    const condition = this.newBlock();
    if (this.current !== undefined) {
      this.edge(this.current, condition, "normal");
    }
    this.current = condition;
    this.addText(stmt.expression, firstLine(stmt.expression.getText(this.sourceFile)));

    const after = this.newBlock();
    const body = this.newBlock();
    this.edge(condition, body, "true");
    this.edge(condition, after, "false");

    this.stack.push({ kind: "loop", label, breakTarget: after, continueTarget: condition });
    this.current = body;
    this.statement(stmt.statement);
    if (this.current !== undefined) {
      this.edge(this.current, condition, "back");
    }
    this.stack.pop();
    this.current = after;
  }

  private doStatement(stmt: ts.DoStatement): void {
    const label = this.takeLoopLabel();
    const body = this.newBlock();
    if (this.current !== undefined) {
      this.edge(this.current, body, "normal");
    }
    const condition = this.newBlock();
    const after = this.newBlock();

    this.stack.push({ kind: "loop", label, breakTarget: after, continueTarget: condition });
    this.current = body;
    this.statement(stmt.statement);
    if (this.current !== undefined) {
      this.edge(this.current, condition, "normal");
    }
    this.stack.pop();

    this.current = condition;
    this.addText(stmt.expression, firstLine(stmt.expression.getText(this.sourceFile)));
    this.edge(condition, body, "back");
    this.edge(condition, after, "false");
    this.current = after;
  }

  private forStatement(stmt: ts.ForStatement): void {
    const label = this.takeLoopLabel();
    if (stmt.initializer !== undefined) {
      this.addText(stmt.initializer, firstLine(stmt.initializer.getText(this.sourceFile)));
    }
    const previous = this.ensureCurrent();

    // No condition (`for (;;)`) means the loop head is the body itself and the
    // only way out is a break.
    const condition = stmt.condition === undefined ? undefined : this.newBlock();
    const body = this.newBlock();
    const after = this.newBlock();
    const head = condition ?? body;
    this.edge(previous, head, "normal");
    if (condition !== undefined) {
      this.current = condition;
      this.addText(
        stmt.condition as ts.Expression,
        firstLine((stmt.condition as ts.Expression).getText(this.sourceFile)),
      );
      this.edge(condition, body, "true");
      this.edge(condition, after, "false");
    }

    const update = stmt.incrementor === undefined ? undefined : this.newBlock();
    const continueTarget = update ?? head;
    this.stack.push({ kind: "loop", label, breakTarget: after, continueTarget });
    this.current = body;
    this.statement(stmt.statement);
    if (this.current !== undefined) {
      this.edge(this.current, continueTarget, update === undefined ? "back" : "normal");
    }
    if (update !== undefined) {
      this.current = update;
      this.addText(
        stmt.incrementor as ts.Expression,
        firstLine((stmt.incrementor as ts.Expression).getText(this.sourceFile)),
      );
      this.edge(update, head, "back");
    }
    this.stack.pop();
    this.current = after;
  }

  private forEachStatement(stmt: ts.ForOfStatement | ts.ForInStatement): void {
    const label = this.takeLoopLabel();
    const head = this.newBlock();
    if (this.current !== undefined) {
      this.edge(this.current, head, "normal");
    }
    this.current = head;
    const keyword = ts.isForOfStatement(stmt) ? "of" : "in";
    this.addText(
      stmt.expression,
      firstLine(
        `${stmt.initializer.getText(this.sourceFile)} ${keyword} ${stmt.expression.getText(this.sourceFile)}`,
      ),
    );
    if (ts.isForOfStatement(stmt) && stmt.awaitModifier !== undefined) {
      head.awaits = true;
    }

    const body = this.newBlock();
    const after = this.newBlock();
    this.edge(head, body, "true");
    this.edge(head, after, "false");

    this.stack.push({ kind: "loop", label, breakTarget: after, continueTarget: head });
    this.current = body;
    this.statement(stmt.statement);
    if (this.current !== undefined) {
      this.edge(this.current, head, "back");
    }
    this.stack.pop();
    this.current = after;
  }

  private switchStatement(stmt: ts.SwitchStatement): void {
    this.startConditionBlock();
    this.addText(stmt.expression, firstLine(`switch ${stmt.expression.getText(this.sourceFile)}`));
    const dispatch = this.ensureCurrent();
    const after = this.newBlock();
    this.stack.push({ kind: "switch", breakTarget: after });

    let hasDefault = false;
    let fallthrough: CfgBlock | undefined;
    for (const clause of stmt.caseBlock.clauses) {
      const clauseBlock = this.newBlock();
      if (ts.isCaseClause(clause)) {
        this.edge(
          dispatch,
          clauseBlock,
          "case",
          firstLine(clause.expression.getText(this.sourceFile)),
        );
      } else {
        hasDefault = true;
        this.edge(dispatch, clauseBlock, "case", "default");
      }
      if (fallthrough !== undefined) {
        this.edge(fallthrough, clauseBlock, "normal");
      }
      this.current = clauseBlock;
      for (const inner of clause.statements) {
        this.statement(inner);
      }
      fallthrough = this.current;
    }
    if (fallthrough !== undefined) {
      this.edge(fallthrough, after, "normal");
    }
    if (!hasDefault) {
      this.edge(dispatch, after, "case", "no match");
    }
    this.stack.pop();
    this.current = after;
  }

  private tryStatement(stmt: ts.TryStatement): void {
    const tryEntry = this.newBlock();
    if (this.current !== undefined) {
      this.edge(this.current, tryEntry, "normal");
    }

    const finallyFrame: Frame | undefined =
      stmt.finallyBlock === undefined
        ? undefined
        : { kind: "finally", entry: this.newBlock(), pending: [] };
    const catchEntry = stmt.catchClause === undefined ? undefined : this.newBlock();

    // Order matters: catch is *inner* so a throw in the try body reaches the
    // catch without running this try's finally.
    if (finallyFrame !== undefined) {
      this.stack.push(finallyFrame);
    }
    if (catchEntry !== undefined) {
      this.stack.push({ kind: "catch", entry: catchEntry });
      // Any statement in the try region may throw; summarize as one edge.
      this.edge(tryEntry, catchEntry, "exception");
    }
    this.current = tryEntry;
    for (const inner of stmt.tryBlock.statements) {
      this.statement(inner);
    }
    const tryEnd = this.current;
    if (catchEntry !== undefined) {
      this.stack.pop(); // catch no longer guards its own handler
    }

    let catchEnd: CfgBlock | undefined;
    if (stmt.catchClause !== undefined && catchEntry !== undefined) {
      this.current = catchEntry;
      if (stmt.catchClause.variableDeclaration !== undefined) {
        this.addText(
          stmt.catchClause.variableDeclaration,
          firstLine(`catch (${stmt.catchClause.variableDeclaration.getText(this.sourceFile)})`),
        );
      }
      for (const inner of stmt.catchClause.block.statements) {
        this.statement(inner);
      }
      catchEnd = this.current;
    }

    if (finallyFrame !== undefined && finallyFrame.kind === "finally") {
      this.stack.pop(); // jumps inside the finally body route past it
      if (tryEnd !== undefined) {
        this.edge(tryEnd, finallyFrame.entry, "normal");
      }
      if (catchEnd !== undefined) {
        this.edge(catchEnd, finallyFrame.entry, "normal");
      }
      this.current = finallyFrame.entry;
      for (const inner of (stmt.finallyBlock as ts.Block).statements) {
        this.statement(inner);
      }
      const finallyEnd = this.current;
      const after = this.newBlock();
      if (finallyEnd !== undefined) {
        // Normal completion continues after the try…
        if (tryEnd !== undefined || catchEnd !== undefined) {
          this.edge(finallyEnd, after, "normal");
        }
        // …and every jump that was re-routed through the finally is replayed
        // from its end (possibly into an outer finally, recursively).
        for (const pending of finallyFrame.pending) {
          this.performJump(finallyEnd, pending);
        }
      }
      this.current = after;
    } else {
      const after = this.newBlock();
      if (tryEnd !== undefined) {
        this.edge(tryEnd, after, "normal");
      }
      if (catchEnd !== undefined) {
        this.edge(catchEnd, after, "normal");
      }
      this.current = after;
    }
  }

  private labeledStatement(stmt: ts.LabeledStatement): void {
    const label = stmt.label.text;
    if (ts.isIterationStatement(stmt.statement, false)) {
      // The loop itself owns the label, so labeled continue can find it.
      this.pendingLoopLabel = label;
      this.statement(stmt.statement);
      return;
    }
    const after = this.newBlock();
    this.stack.push({ kind: "label", label, breakTarget: after });
    this.statement(stmt.statement);
    this.stack.pop();
    if (this.current !== undefined) {
      this.edge(this.current, after, "normal");
    }
    this.current = after;
  }

  // ---- cleanup ----

  /**
   * Splice out empty basic blocks whose single outgoing edge is `normal`
   * (join/after blocks), preserving each incoming edge's kind and label.
   * Unreachable *code* is never dropped: only empty, edge-only blocks go.
   */
  private simplify(): void {
    let changed = true;
    while (changed) {
      changed = false;
      for (const block of this.blocks) {
        if (block.kind !== "basic" || block.statements.length > 0) {
          continue;
        }
        const outgoing = this.edges.filter((edge) => edge.from === block.id);
        const incoming = this.edges.filter((edge) => edge.to === block.id);
        const [only] = outgoing;
        if (
          outgoing.length === 1 &&
          only !== undefined &&
          only.kind === "normal" &&
          only.to !== block.id
        ) {
          for (const edge of incoming) {
            edge.to = only.to;
          }
          this.removeBlock(block, [only]);
          changed = true;
          break;
        }
        if (incoming.length === 0) {
          // Dangling empty block (e.g. after a jump) that nothing ever enters.
          this.removeBlock(block, outgoing);
          changed = true;
          break;
        }
      }
    }
    // Splices can leave duplicate edges; merge them.
    const seen = new Set<string>();
    for (let at = this.edges.length - 1; at >= 0; at -= 1) {
      const edge = this.edges[at];
      if (edge === undefined) {
        continue;
      }
      const key = `${edge.from}→${edge.to}:${edge.kind}:${edge.label ?? ""}`;
      // Self-edges are splice artifacts — except a `back` self-loop, which is a
      // real infinite loop (`for (;;) {}`) and stays visible.
      if (seen.has(key) || (edge.from === edge.to && edge.kind !== "back")) {
        this.edges.splice(at, 1);
      } else {
        seen.add(key);
      }
    }
  }

  private removeBlock(block: CfgBlock, edges: CfgEdge[]): void {
    this.blocks.splice(this.blocks.indexOf(block), 1);
    for (const edge of edges) {
      const at = this.edges.indexOf(edge);
      if (at !== -1) {
        this.edges.splice(at, 1);
      }
    }
  }
}

// ---- file-level extraction ----

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

function enclosingClassName(node: ts.Node): string | undefined {
  let parent: ts.Node | undefined = node.parent;
  while (parent !== undefined) {
    if (ts.isClassLike(parent)) {
      return parent.name?.text;
    }
    parent = parent.parent;
  }
  return undefined;
}

function functionName(node: FunctionLike, sourceFile: ts.SourceFile): string {
  const className = enclosingClassName(node);
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
  // Anonymous: prefer the variable or property it's assigned to.
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  return "<anonymous>";
}

function scriptKindFor(path: string): ts.ScriptKind {
  if (path.endsWith(".tsx")) {
    return ts.ScriptKind.TSX;
  }
  if (path.endsWith(".jsx")) {
    return ts.ScriptKind.JSX;
  }
  if (path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".cjs")) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

/**
 * Build a control-flow graph for every function-like with a body in `file`,
 * nested functions included, in source order. Pure and deterministic.
 */
export function extractControlFlow(file: FileInput): ExtractedControlFlow {
  const sourceFile = ts.createSourceFile(
    file.path,
    file.text,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(file.path),
  );
  const cfgs: ControlFlowGraph[] = [];
  const diagnostics: Diagnostic[] = [];

  const visit = (node: ts.Node): void => {
    if (isFunctionLike(node) && node.body !== undefined) {
      try {
        const builder = new FunctionCfgBuilder(sourceFile);
        builder.build(node.body);
        cfgs.push(builder.finish(functionName(node, sourceFile), spanOf(node, sourceFile)));
      } catch (error) {
        diagnostics.push({
          severity: "error",
          message: `control-flow extraction failed for ${functionName(node, sourceFile)}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          file: file.path,
        });
      }
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return { cfgs, diagnostics };
}

/** The innermost function whose span contains `line` (1-based), if any. */
export function cfgAtLine(
  cfgs: readonly ControlFlowGraph[],
  line: number,
): ControlFlowGraph | undefined {
  let best: ControlFlowGraph | undefined;
  for (const cfg of cfgs) {
    if (line < cfg.span.startLine || line > cfg.span.endLine) {
      continue;
    }
    if (
      best === undefined ||
      cfg.span.endLine - cfg.span.startLine < best.span.endLine - best.span.startLine
    ) {
      best = cfg;
    }
  }
  return best;
}

// cfgBlockLabel and reachableCfgBlocks live in queries.ts: they are bundled by
// the webview, which must never pull this module's `typescript` import.
