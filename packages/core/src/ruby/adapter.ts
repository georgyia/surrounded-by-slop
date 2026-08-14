import type { AnalysisOptions, FileInput, LanguageAdapter } from "../adapter.js";
import type { AnalysisResult } from "../ir/types.js";
import { analyzeWithTreeSitter, type LanguageQueries } from "../treesitter/mapper.js";
import { loadTreeSitterLanguage } from "../treesitter/runtime.js";

/**
 * Ruby adapter (#69) — tree-sitter structure, `require_relative` resolution,
 * heuristic same-file calls (`callGraph: "heuristic"`, low-confidence edges).
 *
 * `module A; class B` nests, and the mapper derives containment and qualified
 * names from span nesting, so `A.B` and `A.B.method` fall out with flat
 * queries and no special-casing.
 *
 * Documented limits — a syntax-only pass cannot see through Ruby's dynamism,
 * and guessing would be worse than admitting it:
 *
 * - **`class << self`** (singleton class bodies) contributes its methods to
 *   the enclosing class by nesting, but they are not marked as class methods;
 *   `def self.foo` likewise reads as a plain method named `foo`.
 * - **`define_method`, `method_missing`, `include`d modules and anything else
 *   metaprogrammed** are invisible. A method that only exists at runtime
 *   cannot appear in a static graph.
 * - **Calls resolve by name within a file.** Ruby has no static call
 *   resolution at all — no receiver types, no arity checking — so every call
 *   edge is a guess and is drawn dimmed and marked `confidence: "low"`.
 * - **`require "json"`** is almost always a gem, so it stays external; only
 *   `require_relative` resolves inside the project.
 */

/** The Ruby query set — the whole language mapping, per the SBS-080 convention. */
export const rubyQueries: LanguageQueries = {
  structure: [
    "(class name: (constant) @class.name) @class.def",
    "(class name: (scope_resolution name: (constant) @class.name)) @class.def",
    "(module name: (constant) @class.name) @class.def",
    "(module name: (scope_resolution name: (constant) @class.name)) @class.def",
    "(method name: (identifier) @function.name) @function.def",
    "(method name: (setter) @function.name) @function.def",
    "(singleton_method name: (identifier) @function.name) @function.def",
  ].join("\n"),
  // Both forms are captured; the resolver decides which can be a project file.
  imports: [
    "(call method: (identifier) @_require arguments: (argument_list (string (string_content) @import.module)))",
  ].join("\n"),
  calls: ["(call method: (identifier) @call.name)", "(program (identifier) @call.name)"].join("\n"),
};

/**
 * `require_relative "../lib/store"` → a project file; a bare `require` names a
 * gem and stays external.
 *
 * The capture is the string body only, so the two forms are indistinguishable
 * here — which is fine, because the test is the same either way: does this
 * path point at a file we are analyzing? A gem name never will.
 */
export function resolveRubyRequire(
  projectFiles: ReadonlySet<string>,
  fromFile: string,
  moduleText: string,
): string | undefined {
  const fromDir = fromFile.split("/").slice(0, -1);
  const segments: string[] = [];
  for (const segment of moduleText.split("/")) {
    if (segment === "." || segment === "") {
      continue;
    }
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  if (segments.length === 0) {
    return undefined;
  }
  // Relative to the requiring file first (require_relative's own rule), then
  // from the project root, which covers a `$LOAD_PATH`-style `require "lib/x"`.
  const leading = moduleText.split("/").filter((part) => part === "..").length;
  const base = fromDir.slice(0, Math.max(0, fromDir.length - leading));
  for (const candidate of [[...base, ...segments].join("/"), segments.join("/")]) {
    const path = candidate.endsWith(".rb") ? candidate : `${candidate}.rb`;
    if (path !== fromFile && projectFiles.has(path)) {
      return path;
    }
  }
  return undefined;
}

export interface RubyWasm {
  /** Bytes of web-tree-sitter's runtime (`web-tree-sitter.wasm`). */
  runtime: Uint8Array;
  /** Bytes of the Ruby grammar (`tree-sitter-ruby.wasm`). */
  ruby: Uint8Array;
}

/**
 * Load the grammar once (on demand — first `.rb` file), after which analysis
 * is synchronous like every adapter. See SBS-080 for the runtime contract.
 */
export async function createRubyAdapter(wasm: RubyWasm): Promise<LanguageAdapter> {
  const language = await loadTreeSitterLanguage(wasm.runtime, wasm.ruby);
  return {
    id: "ruby",
    displayName: "Ruby",
    extensions: [".rb"],
    capabilities: { imports: true, callGraph: "heuristic", cfg: false, dataflow: false },
    analyze(files: readonly FileInput[], options?: AnalysisOptions): AnalysisResult {
      const paths = new Set(files.map((file) => file.path));
      return analyzeWithTreeSitter({
        files: [...files],
        language,
        queries: rubyQueries,
        resolveModule: (fromFile, moduleText) => resolveRubyRequire(paths, fromFile, moduleText),
        cancellation: options?.cancellation,
      });
    },
  };
}
