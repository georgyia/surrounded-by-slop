import type { AnalysisOptions, FileInput, LanguageAdapter } from "../adapter.js";
import type { AnalysisResult } from "../ir/types.js";
import { analyzeWithTreeSitter, type LanguageQueries } from "../treesitter/mapper.js";
import { loadTreeSitterLanguage } from "../treesitter/runtime.js";

/**
 * Python adapter (SBS-081) — tree-sitter structure, real intra-project import
 * resolution, heuristic same-module calls (`callGraph: "heuristic"`, edges
 * marked low-confidence).
 *
 * Documented limits: no cross-module call resolution (imports carry that
 * signal at module level), no namespace packages beyond `__init__.py`, star
 * imports contribute an import edge but no names, dynamic imports invisible.
 */

/** The Python query set — the whole language mapping, per the SBS-080 convention. */
export const pythonQueries: LanguageQueries = {
  structure: [
    "(class_definition name: (identifier) @class.name) @class.def",
    "(function_definition name: (identifier) @function.name) @function.def",
  ].join("\n"),
  imports: [
    "(import_statement name: (dotted_name) @import.module)",
    "(import_statement name: (aliased_import name: (dotted_name) @import.module))",
    "(import_from_statement module_name: (dotted_name) @import.module)",
    "(import_from_statement module_name: (relative_import) @import.module)",
  ].join("\n"),
  calls: [
    "(call function: (identifier) @call.name)",
    "(call function: (attribute attribute: (identifier) @call.name))",
  ].join("\n"),
};

/** Resolve `a.b`, `.sibling` or `..pkg.mod` to a project file, else external. */
export function resolvePythonModule(
  projectFiles: ReadonlySet<string>,
  fromFile: string,
  moduleText: string,
): string | undefined {
  const tryCandidates = (base: string): string | undefined => {
    const candidates = base === "" ? [] : [`${base}.py`, `${base}/__init__.py`];
    return candidates.find((candidate) => projectFiles.has(candidate));
  };
  if (moduleText.startsWith(".")) {
    const dots = moduleText.length - moduleText.replace(/^\.+/, "").length;
    const rest = moduleText.slice(dots).split(".").filter(Boolean);
    const fromDir = fromFile.split("/").slice(0, -1);
    // One dot = the file's own package; each further dot climbs one package up.
    const baseSegments = fromDir.slice(0, fromDir.length - (dots - 1));
    // More dots than packages to climb: the import escapes the project.
    if (dots - 1 > fromDir.length) {
      return undefined;
    }
    const base = [...baseSegments, ...rest].join("/");
    return tryCandidates(base) ?? tryCandidates([...baseSegments].join("/"));
  }
  return tryCandidates(moduleText.split(".").join("/"));
}

export interface PythonWasm {
  /** Bytes of web-tree-sitter's runtime (`web-tree-sitter.wasm`). */
  runtime: Uint8Array;
  /** Bytes of the Python grammar (`tree-sitter-python.wasm`). */
  python: Uint8Array;
}

/**
 * Load the grammar once (on demand — first `.py` use), then analysis itself
 * is synchronous like every adapter. See SBS-080 for the runtime contract.
 */
export async function createPythonAdapter(wasm: PythonWasm): Promise<LanguageAdapter> {
  const language = await loadTreeSitterLanguage(wasm.runtime, wasm.python);
  return {
    id: "python",
    displayName: "Python",
    extensions: [".py"],
    capabilities: { imports: true, callGraph: "heuristic", cfg: false, dataflow: false },
    analyze(files: readonly FileInput[], options?: AnalysisOptions): AnalysisResult {
      const paths = new Set(files.map((file) => file.path));
      return analyzeWithTreeSitter({
        files: [...files],
        language,
        queries: pythonQueries,
        resolveModule: (fromFile, moduleText) => resolvePythonModule(paths, fromFile, moduleText),
        cancellation: options?.cancellation,
      });
    },
  };
}
