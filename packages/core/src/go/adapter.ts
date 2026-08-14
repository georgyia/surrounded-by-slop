import type { AnalysisOptions, FileInput, LanguageAdapter } from "../adapter.js";
import type { AnalysisResult } from "../ir/types.js";
import { analyzeWithTreeSitter, type LanguageQueries } from "../treesitter/mapper.js";
import { loadTreeSitterLanguage } from "../treesitter/runtime.js";

/**
 * Go adapter (#62) — tree-sitter structure, imports, and heuristic same-module
 * calls (`callGraph: "heuristic"`, edges marked low-confidence).
 *
 * Documented limits, so the diagram never claims more than it knows:
 *
 * - **Imports are external.** A Go import path names a *package* (a directory
 *   of files), while the IR's module nodes are per-file, so there is no honest
 *   one-to-one target to resolve to. Resolving intra-project imports needs the
 *   module path from `go.mod`, which the adapter never sees (it receives `.go`
 *   files only). Every import therefore materializes an external module node
 *   named by its import path.
 * - **Methods read as functions.** Containment comes from span nesting, and a
 *   Go method sits beside its type rather than inside it (`func (s *Server)
 *   Run()`), so it cannot nest. The receiver is kept in the qualified name via
 *   the label, but the node kind stays `function`.
 * - **Calls are heuristic**, resolved by name within a file — no type checker,
 *   so honesty beats guessing.
 */

/** The Go query set — the whole language mapping, per the SBS-080 convention. */
export const goQueries: LanguageQueries = {
  structure: [
    // A named type is the closest thing Go has to a class: structs and
    // interfaces both arrive as type_spec, and both can hold members.
    "(type_declaration (type_spec name: (type_identifier) @class.name)) @class.def",
    "(function_declaration name: (identifier) @function.name) @function.def",
    // Methods: the name is a field_identifier, and the receiver stays in the
    // definition span so the label can show it.
    "(method_declaration name: (field_identifier) @function.name) @function.def",
  ].join("\n"),
  imports: [
    "(import_spec path: (interpreted_string_literal) @import.module)",
    "(import_spec path: (raw_string_literal) @import.module)",
  ].join("\n"),
  calls: [
    "(call_expression function: (identifier) @call.name)",
    "(call_expression function: (selector_expression field: (field_identifier) @call.name))",
  ].join("\n"),
};

/**
 * Go import paths are quoted string literals, and the grammar hands back the
 * literal including its delimiters. Strip them so an external module node
 * reads `fmt` rather than `"fmt"`.
 */
export function normalizeGoImport(raw: string): string {
  return raw.replace(/^["`]/, "").replace(/["`]$/, "");
}

export interface GoWasm {
  /** Bytes of web-tree-sitter's runtime (`web-tree-sitter.wasm`). */
  runtime: Uint8Array;
  /** Bytes of the Go grammar (`tree-sitter-go.wasm`). */
  go: Uint8Array;
}

/**
 * Load the grammar once (on demand — first `.go` file), after which analysis
 * is synchronous like every adapter. See SBS-080 for the runtime contract.
 */
export async function createGoAdapter(wasm: GoWasm): Promise<LanguageAdapter> {
  const language = await loadTreeSitterLanguage(wasm.runtime, wasm.go);
  return {
    id: "go",
    displayName: "Go",
    extensions: [".go"],
    capabilities: { imports: true, callGraph: "heuristic", cfg: false, dataflow: false },
    analyze(files: readonly FileInput[], options?: AnalysisOptions): AnalysisResult {
      return analyzeWithTreeSitter({
        files: [...files],
        language,
        queries: goQueries,
        // Package-vs-file granularity (see the note above): every import is an
        // external module node until go.mod resolution exists.
        resolveModule: () => undefined,
        normalizeModuleText: normalizeGoImport,
        cancellation: options?.cancellation,
      });
    },
  };
}
