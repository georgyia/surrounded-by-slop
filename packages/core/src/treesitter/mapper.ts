import type { Node } from "web-tree-sitter";
import type { CancellationToken, FileInput } from "../adapter.js";
import { OperationCancelledError } from "../adapter.js";
import {
  canonicalizeGraph,
  declarationId,
  edgeId,
  externalModuleId,
  IdAllocator,
  moduleId,
} from "../ir/ids.js";
import type { AnalysisResult, Diagnostic, GraphEdge, GraphNode, SourceSpan } from "../ir/types.js";
import type { LoadedLanguage } from "./runtime.js";

/**
 * The query-file convention (SBS-080): a tree-sitter language becomes a Slop
 * adapter through three queries and a module resolver — no per-language graph
 * code. Capture names are the contract:
 *
 * - structure: `@class.def` + `@class.name`, `@function.def` + `@function.name`
 *   per match, and optionally `@namespace.def` + `@namespace.name` for a named
 *   container that is not a type (C#'s `namespace`). Containment and
 *   method-ness are derived from span nesting, so queries stay flat and simple
 *   — a function inside a class is a method, one inside a namespace is not.
 * - imports:   `@import.module` on the node holding the imported module path.
 * - calls:     `@call.name` on the callee's name node. Calls resolve
 *   heuristically to same-module declarations by name and are marked
 *   low-confidence (`callGraph: "heuristic"`).
 */
export interface LanguageQueries {
  structure: string;
  imports: string;
  calls: string;
}

export interface TreeSitterAnalysisOptions {
  files: readonly FileInput[];
  language: LoadedLanguage;
  queries: LanguageQueries;
  /** Resolve an import's module text to a project file path; undefined = external. */
  resolveModule(fromFile: string, moduleText: string): string | undefined;
  /**
   * Clean up the raw capture text before it is resolved or shown. Languages
   * that quote their import paths (Go's `"fmt"`, Java's trailing `;`) strip
   * here, so an external module node reads `fmt` and not `"fmt"`. Defaults to
   * the raw text.
   */
  normalizeModuleText?(raw: string): string;
  cancellation?: CancellationToken | undefined;
}

function spanOf(node: Node, file: string): SourceSpan {
  return {
    file,
    startLine: node.startPosition.row + 1,
    startCol: node.startPosition.column + 1,
    endLine: node.endPosition.row + 1,
    endCol: node.endPosition.column + 1,
  };
}

function contains(outer: SourceSpan, inner: SourceSpan): boolean {
  const startsBefore =
    outer.startLine < inner.startLine ||
    (outer.startLine === inner.startLine && outer.startCol <= inner.startCol);
  const endsAfter =
    outer.endLine > inner.endLine ||
    (outer.endLine === inner.endLine && outer.endCol >= inner.endCol);
  return (
    startsBefore &&
    endsAfter &&
    !(
      outer.startLine === inner.startLine &&
      outer.endLine === inner.endLine &&
      outer.startCol === inner.startCol &&
      outer.endCol === inner.endCol
    )
  );
}

/**
 * What a `@<kind>.def` capture may declare. `namespace` exists because some
 * languages (C#) have a named container that is not a type — a function inside
 * one is still a function, not a method.
 */
type DeclarationKind = "class" | "function" | "namespace";

function isDeclarationKind(kind: string | undefined): kind is DeclarationKind {
  return kind === "class" || kind === "function" || kind === "namespace";
}

interface Declaration {
  kind: "class" | "function" | "method" | "namespace";
  name: string;
  qualifiedName: string;
  id: string;
  defSpan: SourceSpan;
  nameSpan: SourceSpan;
  parent: Declaration | undefined;
}

/** Run the three queries over every file and assemble one semantic graph. */
export function analyzeWithTreeSitter(options: TreeSitterAnalysisOptions): AnalysisResult {
  const { files, language, queries, resolveModule, cancellation } = options;
  const normalizeModuleText = options.normalizeModuleText ?? ((raw: string) => raw);
  const nodes: GraphNode[] = [];
  const edgeById = new Map<string, GraphEdge>();
  const diagnostics: Diagnostic[] = [];
  const externals = new Map<string, string>(); // module text → node id
  const ids = new IdAllocator();

  const addEdge = (edge: GraphEdge): void => {
    const existing = edgeById.get(edge.id);
    if (existing === undefined) {
      edgeById.set(edge.id, edge);
    } else {
      existing.count = (existing.count ?? 1) + 1;
    }
  };

  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    if (cancellation?.cancelled) {
      throw new OperationCancelledError();
    }
    const tree = language.parse(file.text);
    if (tree.rootNode.hasError) {
      diagnostics.push({
        severity: "warning",
        message: "file has syntax errors; the graph for it may be partial",
        file: file.path,
      });
    }
    const moduleNodeId = moduleId(file.path);
    const moduleName = file.path.split("/").pop() ?? file.path;
    nodes.push({
      id: moduleNodeId,
      kind: "module",
      name: moduleName,
      qualifiedName: file.path,
      span: spanOf(tree.rootNode, file.path),
    });

    // --- structure: defs, then containment by span nesting ---
    const raw: { kind: DeclarationKind; def: Node; name: Node }[] = [];
    for (const match of language.query(queries.structure).matches(tree.rootNode)) {
      const def = match.captures.find((capture) => capture.name.endsWith(".def"))?.node;
      const name = match.captures.find((capture) => capture.name.endsWith(".name"))?.node;
      const kind = match.captures[0]?.name.split(".")[0];
      if (def === undefined || name === undefined || !isDeclarationKind(kind)) {
        continue;
      }
      raw.push({ kind, def, name });
    }
    // Outer-first, so parents exist before their members.
    raw.sort((a, b) => a.def.startIndex - b.def.startIndex || b.def.endIndex - a.def.endIndex);
    const declarations: Declaration[] = [];
    for (const entry of raw) {
      const defSpan = spanOf(entry.def, file.path);
      let parent: Declaration | undefined;
      for (let at = declarations.length - 1; at >= 0; at -= 1) {
        const candidate = declarations[at];
        if (candidate !== undefined && contains(candidate.defSpan, defSpan)) {
          parent = candidate;
          break;
        }
      }
      const name = entry.name.text;
      const kind = entry.kind === "function" && parent?.kind === "class" ? "method" : entry.kind;
      const qualifiedName = parent === undefined ? name : `${parent.qualifiedName}.${name}`;
      const declaration: Declaration = {
        kind,
        name,
        qualifiedName,
        // Overloads (Java, C#) and re-definitions (Python) put two declarations
        // under one qualified name, which would mint the same id twice and
        // produce an invalid graph. The allocator suffixes the later ones, the
        // same way the TypeScript adapter has always handled it.
        id: ids.allocate(declarationId(kind, file.path, qualifiedName)),
        defSpan,
        nameSpan: spanOf(entry.name, file.path),
        parent,
      };
      declarations.push(declaration);
      nodes.push({
        id: declaration.id,
        kind,
        name,
        qualifiedName,
        span: defSpan,
      });
      const container = parent?.id ?? moduleNodeId;
      addEdge({
        id: edgeId("contains", container, declaration.id),
        kind: "contains",
        from: container,
        to: declaration.id,
      });
    }

    // --- imports ---
    for (const match of language.query(queries.imports).matches(tree.rootNode)) {
      for (const capture of match.captures) {
        if (capture.name !== "import.module") {
          continue;
        }
        const text = normalizeModuleText(capture.node.text);
        if (text === "") {
          continue;
        }
        const resolved = resolveModule(file.path, text);
        let target: string;
        if (resolved !== undefined) {
          target = moduleId(resolved);
        } else {
          let external = externals.get(text);
          if (external === undefined) {
            external = externalModuleId(text);
            externals.set(text, external);
            nodes.push({
              id: external,
              kind: "module",
              name: text,
              qualifiedName: text,
              external: true,
            });
          }
          target = external;
        }
        if (target !== moduleNodeId) {
          addEdge({
            id: edgeId("imports", moduleNodeId, target),
            kind: "imports",
            from: moduleNodeId,
            to: target,
          });
        }
      }
    }

    // --- calls: heuristic, same module, by name ---
    const byName = new Map<string, Declaration>();
    for (const declaration of declarations) {
      // Only callables are call targets — a type or a namespace never is.
      if (
        declaration.kind !== "class" &&
        declaration.kind !== "namespace" &&
        !byName.has(declaration.name)
      ) {
        byName.set(declaration.name, declaration);
      }
    }
    for (const match of language.query(queries.calls).matches(tree.rootNode)) {
      const nameNode = match.captures.find((capture) => capture.name === "call.name")?.node;
      if (nameNode === undefined) {
        continue;
      }
      const target = byName.get(nameNode.text);
      if (target === undefined) {
        continue; // out-of-module or builtin — the heuristic stays quiet
      }
      const callSpan = spanOf(nameNode, file.path);
      let source: string = moduleNodeId;
      for (let at = declarations.length - 1; at >= 0; at -= 1) {
        const candidate = declarations[at];
        if (candidate !== undefined && contains(candidate.defSpan, callSpan)) {
          source = candidate.id;
          break;
        }
      }
      if (source !== target.id) {
        addEdge({
          id: edgeId("calls", source, target.id),
          kind: "calls",
          from: source,
          to: target.id,
          confidence: "low",
        });
      }
    }
  }

  // Drop external modules nothing ended up importing (deduped away targets).
  const referenced = new Set<string>();
  for (const edge of edgeById.values()) {
    referenced.add(edge.from);
    referenced.add(edge.to);
  }
  const kept = nodes.filter((node) => node.external !== true || referenced.has(node.id));
  return {
    graph: canonicalizeGraph({ schemaVersion: 1, nodes: kept, edges: [...edgeById.values()] }),
    diagnostics,
  };
}
