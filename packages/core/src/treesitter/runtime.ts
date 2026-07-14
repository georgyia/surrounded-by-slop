import type { Language, Parser, Query, Tree } from "web-tree-sitter";

/**
 * The tree-sitter WASM runtime (SBS-080, decision: languages beyond
 * TypeScript parse via tree-sitter so a new language is mostly queries).
 *
 * Pure-core rules still apply: no filesystem here — callers hand over the
 * wasm bytes (tests read them from node_modules, the extension from its
 * bundled dist/). `web-tree-sitter` is imported dynamically so bundles that
 * never touch tree-sitter (the webview) don't carry it.
 */

export interface LoadedLanguage {
  /** Parse one file's source text (synchronous once loaded). */
  parse(text: string): Tree;
  /** Compile a query against this grammar; results are cached per source. */
  query(source: string): Query;
}

let initialized: Promise<typeof import("web-tree-sitter")> | undefined;

/** Initialize the shared runtime once (measured ~10 ms) and memoize it. */
function runtimeModule(runtimeWasm: Uint8Array): Promise<typeof import("web-tree-sitter")> {
  if (initialized === undefined) {
    initialized = import("web-tree-sitter").then(async (module) => {
      await module.Parser.init({ wasmBinary: runtimeWasm });
      return module;
    });
  }
  return initialized;
}

/**
 * Load one grammar on demand and return a ready, synchronous parsing handle.
 * Await this once per language (e.g. on the first `.py` file), then analysis
 * itself stays synchronous like every other adapter.
 */
export async function loadTreeSitterLanguage(
  runtimeWasm: Uint8Array,
  grammarWasm: Uint8Array,
): Promise<LoadedLanguage> {
  const module = await runtimeModule(runtimeWasm);
  const language: Language = await module.Language.load(grammarWasm);
  const parser: Parser = new module.Parser();
  parser.setLanguage(language);
  const queries = new Map<string, Query>();
  return {
    parse(text) {
      const tree = parser.parse(text);
      if (tree === null) {
        throw new Error("tree-sitter returned no tree (parser was reset mid-parse)");
      }
      return tree;
    },
    query(source) {
      let compiled = queries.get(source);
      if (compiled === undefined) {
        compiled = new module.Query(language, source);
        queries.set(source, compiled);
      }
      return compiled;
    },
  };
}
