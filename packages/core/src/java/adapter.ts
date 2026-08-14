import type { AnalysisOptions, FileInput, LanguageAdapter } from "../adapter.js";
import type { AnalysisResult } from "../ir/types.js";
import { analyzeWithTreeSitter, type LanguageQueries } from "../treesitter/mapper.js";
import { loadTreeSitterLanguage } from "../treesitter/runtime.js";

/**
 * Java adapter (#63) — tree-sitter structure, intra-project import resolution,
 * and heuristic same-file calls (`callGraph: "heuristic"`, low-confidence).
 *
 * Java suits this pipeline well: one public type per file means a class's
 * members really do nest inside it, so the mapper's span-nesting containment
 * gives methods for free, and `import a.b.C` names exactly one file.
 *
 * Documented limits: calls resolve by name within a file only (no type
 * checker, so an overload or a call through an interface is a guess and is
 * marked as one); wildcard imports (`import a.b.*`) contribute an import edge
 * to the package, not to each type; and the classpath is invisible, so
 * anything outside the analyzed files is an external module node.
 */

/** The Java query set — the whole language mapping, per the SBS-080 convention. */
export const javaQueries: LanguageQueries = {
  structure: [
    "(class_declaration name: (identifier) @class.name) @class.def",
    "(interface_declaration name: (identifier) @class.name) @class.def",
    "(enum_declaration name: (identifier) @class.name) @class.def",
    "(record_declaration name: (identifier) @class.name) @class.def",
    // Methods and constructors nest inside their type's span, so the mapper
    // turns them into `method` nodes without the query saying so.
    "(method_declaration name: (identifier) @function.name) @function.def",
    "(constructor_declaration name: (identifier) @function.name) @function.def",
  ].join("\n"),
  imports: ["(import_declaration (scoped_identifier) @import.module)"].join("\n"),
  calls: [
    "(method_invocation name: (identifier) @call.name)",
    "(object_creation_expression type: (type_identifier) @call.name)",
  ].join("\n"),
};

/**
 * `a.b.C` → `a/b/C.java` when that file is in the project, else external.
 *
 * Java source roots (`src/main/java`, `src/test/java`, plain `src`) are a
 * build-tool convention rather than part of the import, so the package path is
 * matched as a *suffix*: the same import resolves whether or not the project
 * keeps the Maven layout. A wildcard import names a package, not a type, so it
 * stays external.
 */
export function resolveJavaImport(
  projectFiles: ReadonlySet<string>,
  _fromFile: string,
  moduleText: string,
): string | undefined {
  if (moduleText.endsWith(".*")) {
    return undefined;
  }
  const relative = `${moduleText.split(".").join("/")}.java`;
  if (projectFiles.has(relative)) {
    return relative;
  }
  // Deterministic pick: shortest path first, then alphabetical, so a project
  // with both a main and a test copy always resolves the same way.
  return [...projectFiles]
    .filter((path) => path.endsWith(`/${relative}`))
    .sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
}

export interface JavaWasm {
  /** Bytes of web-tree-sitter's runtime (`web-tree-sitter.wasm`). */
  runtime: Uint8Array;
  /** Bytes of the Java grammar (`tree-sitter-java.wasm`). */
  java: Uint8Array;
}

/**
 * Load the grammar once (on demand — first `.java` file), after which analysis
 * is synchronous like every adapter. See SBS-080 for the runtime contract.
 */
export async function createJavaAdapter(wasm: JavaWasm): Promise<LanguageAdapter> {
  const language = await loadTreeSitterLanguage(wasm.runtime, wasm.java);
  return {
    id: "java",
    displayName: "Java",
    extensions: [".java"],
    capabilities: { imports: true, callGraph: "heuristic", cfg: false, dataflow: false },
    analyze(files: readonly FileInput[], options?: AnalysisOptions): AnalysisResult {
      const paths = new Set(files.map((file) => file.path));
      return analyzeWithTreeSitter({
        files: [...files],
        language,
        queries: javaQueries,
        resolveModule: (fromFile, moduleText) => resolveJavaImport(paths, fromFile, moduleText),
        cancellation: options?.cancellation,
      });
    },
  };
}
