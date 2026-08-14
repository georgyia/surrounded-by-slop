import type { AnalysisOptions, FileInput, LanguageAdapter } from "../adapter.js";
import type { AnalysisResult } from "../ir/types.js";
import { analyzeWithTreeSitter, type LanguageQueries } from "../treesitter/mapper.js";
import { loadTreeSitterLanguage } from "../treesitter/runtime.js";

/**
 * C# adapter (#64) — tree-sitter structure, `using` directives, heuristic
 * same-file calls (`callGraph: "heuristic"`, low-confidence edges).
 *
 * `namespace` maps to the IR's `namespace` kind, so a namespace is a container
 * without being a type: a class inside one nests as a class, and a method
 * inside a *class* is still what becomes a method. Both file-scoped
 * (`namespace X;`) and block namespaces are captured.
 *
 * Documented limits:
 *
 * - **`using` directives stay external.** A namespace has no file mapping in
 *   C# — the convention is not enforced by the compiler, one namespace can
 *   span many files, and one file can declare many namespaces. Guessing a file
 *   from a namespace would be confidently wrong, so v1 draws every `using` as
 *   an external module node, as the issue prescribes.
 * - **Calls resolve by name within a file** — no type checker, so overloads,
 *   interface dispatch and extension methods are guesses, drawn dimmed and
 *   marked `confidence: "low"`.
 * - **File-scoped namespaces do not nest.** A block `namespace X { … }`
 *   contains its types, so they come out as `X.Type.Member`. A file-scoped
 *   `namespace X;` is a one-line declaration in the grammar, with the types
 *   beside it rather than inside it, so they stay unqualified. Both forms
 *   still produce a `namespace` node; only the nesting differs.
 */

/** The C# query set — the whole language mapping, per the SBS-080 convention. */
export const csharpQueries: LanguageQueries = {
  structure: [
    // Both namespace forms: block-bodied and file-scoped.
    "(namespace_declaration name: (identifier) @namespace.name) @namespace.def",
    "(namespace_declaration name: (qualified_name) @namespace.name) @namespace.def",
    "(file_scoped_namespace_declaration name: (identifier) @namespace.name) @namespace.def",
    "(file_scoped_namespace_declaration name: (qualified_name) @namespace.name) @namespace.def",
    "(class_declaration name: (identifier) @class.name) @class.def",
    "(interface_declaration name: (identifier) @class.name) @class.def",
    "(struct_declaration name: (identifier) @class.name) @class.def",
    "(enum_declaration name: (identifier) @class.name) @class.def",
    "(record_declaration name: (identifier) @class.name) @class.def",
    "(method_declaration name: (identifier) @function.name) @function.def",
    "(constructor_declaration name: (identifier) @function.name) @function.def",
    "(local_function_statement name: (identifier) @function.name) @function.def",
  ].join("\n"),
  imports: [
    "(using_directive (qualified_name) @import.module)",
    "(using_directive (identifier) @import.module)",
  ].join("\n"),
  calls: [
    "(invocation_expression function: (identifier) @call.name)",
    "(invocation_expression function: (member_access_expression name: (identifier) @call.name))",
    "(object_creation_expression type: (identifier) @call.name)",
  ].join("\n"),
};

export interface CSharpWasm {
  /** Bytes of web-tree-sitter's runtime (`web-tree-sitter.wasm`). */
  runtime: Uint8Array;
  /** Bytes of the C# grammar (`tree-sitter-c-sharp.wasm`). */
  csharp: Uint8Array;
}

/**
 * Load the grammar once (on demand — first `.cs` file), after which analysis
 * is synchronous like every adapter. See SBS-080 for the runtime contract.
 */
export async function createCSharpAdapter(wasm: CSharpWasm): Promise<LanguageAdapter> {
  const language = await loadTreeSitterLanguage(wasm.runtime, wasm.csharp);
  return {
    id: "csharp",
    displayName: "C#",
    extensions: [".cs"],
    capabilities: { imports: true, callGraph: "heuristic", cfg: false, dataflow: false },
    analyze(files: readonly FileInput[], options?: AnalysisOptions): AnalysisResult {
      return analyzeWithTreeSitter({
        files: [...files],
        language,
        queries: csharpQueries,
        // A namespace names no file (see the note above), so every using is
        // an external module node until project-file parsing exists.
        resolveModule: () => undefined,
        cancellation: options?.cancellation,
      });
    },
  };
}
