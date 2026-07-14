import type { AnalysisOptions, FileInput } from "./adapter.js";
import { canonicalizeGraph } from "./ir/ids.js";
import type { AnalysisResult, Diagnostic, GraphEdge, GraphNode } from "./ir/types.js";
import { SCHEMA_VERSION } from "./ir/types.js";
import { stableStringify } from "./stable-json.js";
import { analyzeTypeScriptProject } from "./typescript/adapter.js";

/**
 * Incremental analysis cache (SBS-091). Wraps the TypeScript adapter with a
 * content-hash cache of per-file graph fragments:
 *
 * - Nothing changed → the previous result is returned as-is.
 * - k files edited (same file set, same options) → only those files plus
 *   their direct importers are re-analyzed, inside a mini-project that
 *   includes two levels of their imports for resolution context; fragments
 *   for every clean file are reused and the graph is re-linked.
 * - A file added/removed, or options changed → full cold analysis (module
 *   resolution can shift arbitrarily, so partial reuse would be unsound).
 *
 * Documented precision limit: a dirty file whose imports resolve through a
 * re-export chain deeper than two hops may see those calls degrade to
 * unresolved sinks until the next cold run. Edges from clean files into
 * declarations an edit removed are dropped at merge (their files are dirty
 * by the importer rule whenever they import the edited file).
 */

export interface IncrementalAnalyzer {
  analyze(files: readonly FileInput[], options?: AnalysisOptions): AnalysisResult;
  /** How the last `analyze` was served — for logging and the speed tests. */
  readonly lastPass: "cold" | "cached" | "partial";
}

/**
 * Two independent 32-bit FNV/Murmur-style lanes over the text, 16 hex chars.
 * Pure JS (no node:crypto) so the webview bundle stays node-free; strong
 * enough for a cache key — and the invalidation tests prove sensitivity.
 */
export function contentHash(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x85ebca6b) >>> 0;
  }
  return `${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}`;
}

/** The per-file slice of an analysis result: what this file contributed. */
interface Fragment {
  nodes: GraphNode[];
  edges: GraphEdge[];
  diagnostics: Diagnostic[];
}

const SHARED = "__shared__"; // external packages & unresolved sinks — no owning file

function fileOfNode(node: GraphNode): string {
  return node.span?.file ?? SHARED;
}

/** Split a result into per-file fragments, attributing edges to their source node's file. */
function toFragments(result: AnalysisResult): Map<string, Fragment> {
  const fragments = new Map<string, Fragment>();
  const get = (file: string): Fragment => {
    let fragment = fragments.get(file);
    if (fragment === undefined) {
      fragment = { nodes: [], edges: [], diagnostics: [] };
      fragments.set(file, fragment);
    }
    return fragment;
  };
  const fileById = new Map<string, string>();
  for (const node of result.graph.nodes) {
    const file = fileOfNode(node);
    fileById.set(node.id, file);
    get(file).nodes.push(node);
  }
  for (const edge of result.graph.edges) {
    get(fileById.get(edge.from) ?? SHARED).edges.push(edge);
  }
  for (const diagnostic of result.diagnostics) {
    get(diagnostic.file ?? SHARED).diagnostics.push(diagnostic);
  }
  return fragments;
}

/** Merge fragments back into one result: dedupe shared nodes, drop dangling edges. */
function merge(fragments: Iterable<Fragment>): AnalysisResult {
  const nodeById = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const fragment of fragments) {
    for (const node of fragment.nodes) {
      nodeById.set(node.id, node);
    }
    edges.push(...fragment.edges);
    diagnostics.push(...fragment.diagnostics);
  }
  const edgeById = new Map<string, GraphEdge>();
  for (const edge of edges) {
    // An edit can remove a declaration a clean file's edge pointed at; the
    // importer rule re-analyzes true dependents, anything left dangling goes.
    if (nodeById.has(edge.from) && nodeById.has(edge.to)) {
      edgeById.set(edge.id, edge);
    }
  }
  // Externals and sinks exist only as edge targets — a cold run materializes
  // them on use, so drop any the merged edges no longer reference (mini-run
  // context files and stale edits would otherwise leak them in).
  const referenced = new Set<string>();
  for (const edge of edgeById.values()) {
    referenced.add(edge.from);
    referenced.add(edge.to);
  }
  const nodes = [...nodeById.values()].filter(
    (node) => node.span !== undefined || referenced.has(node.id),
  );
  const graph = canonicalizeGraph({
    schemaVersion: SCHEMA_VERSION,
    nodes,
    edges: [...edgeById.values()],
  });
  diagnostics.sort(
    (a, b) => (a.file ?? "").localeCompare(b.file ?? "") || a.message.localeCompare(b.message),
  );
  return { graph, diagnostics };
}

export function createIncrementalAnalyzer(): IncrementalAnalyzer {
  let hashes = new Map<string, string>();
  let fragments = new Map<string, Fragment>();
  let previous: AnalysisResult | undefined;
  let previousOptionsKey = "";
  /** file → files that import it (reverse import graph), from the last pass. */
  let importers = new Map<string, Set<string>>();
  /** file → files it imports (forward), for mini-project context. */
  let imports = new Map<string, Set<string>>();
  let lastPass: "cold" | "cached" | "partial" = "cold";

  const rememberDependencies = (result: AnalysisResult): void => {
    importers = new Map();
    imports = new Map();
    const fileOfModule = new Map<string, string>();
    for (const node of result.graph.nodes) {
      if (node.kind === "module" && node.span !== undefined) {
        fileOfModule.set(node.id, node.span.file);
      }
    }
    for (const edge of result.graph.edges) {
      if (edge.kind !== "imports") {
        continue;
      }
      const from = fileOfModule.get(edge.from);
      const to = fileOfModule.get(edge.to);
      if (from === undefined || to === undefined) {
        continue; // external target — no project file to invalidate
      }
      (importers.get(to) ?? importers.set(to, new Set()).get(to))?.add(from);
      (imports.get(from) ?? imports.set(from, new Set()).get(from))?.add(to);
    }
  };

  const cold = (files: readonly FileInput[], options?: AnalysisOptions): AnalysisResult => {
    const result = analyzeTypeScriptProject(files, options);
    previous = result;
    fragments = toFragments(result);
    rememberDependencies(result);
    lastPass = "cold";
    return result;
  };

  return {
    get lastPass() {
      return lastPass;
    },
    analyze(files, options) {
      const optionsKey = stableStringify(options?.adapterOptions ?? {});
      const nextHashes = new Map(files.map((file) => [file.path, contentHash(file.text)]));

      const sameFileSet =
        previous !== undefined &&
        optionsKey === previousOptionsKey &&
        nextHashes.size === hashes.size &&
        [...nextHashes.keys()].every((path) => hashes.has(path));
      previousOptionsKey = optionsKey;

      if (!sameFileSet) {
        hashes = nextHashes;
        return cold(files, options);
      }

      const changed = [...nextHashes].filter(([path, hash]) => hashes.get(path) !== hash);
      hashes = nextHashes;
      if (changed.length === 0 && previous !== undefined) {
        lastPass = "cached";
        return previous;
      }

      // Dirty = edited files plus everything that imports them (their call and
      // import edges may now point elsewhere).
      const dirty = new Set(changed.map(([path]) => path));
      for (const path of [...dirty]) {
        for (const importer of importers.get(path) ?? []) {
          dirty.add(importer);
        }
      }
      // Mini-project: dirty files + two levels of their imports, so the
      // checker resolves their symbols the same way the full project does.
      const context = new Set(dirty);
      for (let depth = 0; depth < 2; depth += 1) {
        for (const path of [...context]) {
          for (const dependency of imports.get(path) ?? []) {
            context.add(dependency);
          }
        }
      }
      const byPath = new Map(files.map((file) => [file.path, file]));
      const miniFiles = [...context]
        .map((path) => byPath.get(path))
        .filter((file): file is FileInput => file !== undefined)
        .sort((a, b) => a.path.localeCompare(b.path));

      const mini = analyzeTypeScriptProject(miniFiles, options);
      const miniFragments = toFragments(mini);
      for (const path of dirty) {
        fragments.set(path, miniFragments.get(path) ?? { nodes: [], edges: [], diagnostics: [] });
      }
      // Shared externals/sinks: keep the union so clean files' targets survive.
      const shared = fragments.get(SHARED) ?? { nodes: [], edges: [], diagnostics: [] };
      const miniShared = miniFragments.get(SHARED);
      if (miniShared !== undefined) {
        const known = new Set(shared.nodes.map((node) => node.id));
        shared.nodes.push(...miniShared.nodes.filter((node) => !known.has(node.id)));
        fragments.set(SHARED, shared);
      }

      const result = merge(fragments.values());
      previous = result;
      fragments = toFragments(result);
      rememberDependencies(result);
      lastPass = "partial";
      return result;
    },
  };
}
