import type { AnalysisOptions, FileInput, LanguageAdapter } from "../adapter.js";
import type { AnalysisResult } from "../ir/types.js";
import { analyzeWithTreeSitter, type LanguageQueries } from "../treesitter/mapper.js";
import { loadTreeSitterLanguage } from "../treesitter/runtime.js";

/**
 * Rust adapter (#70) — tree-sitter structure, module-tree import resolution,
 * heuristic same-file calls (`callGraph: "heuristic"`, low-confidence edges).
 *
 * The one real design decision, and the issue called it: methods live in
 * `impl Foo { fn bar() }`, not inside the type declaration. Since the mapper
 * derives method-ness from a class-kind parent by span nesting, capturing the
 * **impl block** as `@class.def` with the type name as `@class.name` makes
 * `bar` nest inside it and come out as `Foo.bar` with no special-casing — so
 * the adapter stays queries plus a resolver, exactly like the others.
 *
 * A type with an impl block therefore appears twice: once as its declaration
 * (`struct Foo`) and once as the impl that carries its methods. That is
 * faithful to Rust, where the two really are separate items, and a type can
 * have several impl blocks (inherent, plus one per trait).
 *
 * Documented limits: external crates stay external (no Cargo registry
 * resolution); a `use` that names an item rather than a module resolves to the
 * module that holds it; macros are invisible.
 */

/** The Rust query set — the whole language mapping, per the SBS-080 convention. */
export const rustQueries: LanguageQueries = {
  structure: [
    "(struct_item name: (type_identifier) @class.name) @class.def",
    "(enum_item name: (type_identifier) @class.name) @class.def",
    "(trait_item name: (type_identifier) @class.name) @class.def",
    "(union_item name: (type_identifier) @class.name) @class.def",
    "(mod_item name: (identifier) @class.name) @class.def",
    // The impl block is the container that actually holds methods.
    "(impl_item type: (type_identifier) @class.name) @class.def",
    "(impl_item type: (generic_type type: (type_identifier) @class.name)) @class.def",
    "(function_item name: (identifier) @function.name) @function.def",
    // Trait method signatures without a body still declare the method.
    "(function_signature_item name: (identifier) @function.name) @function.def",
  ].join("\n"),
  imports: [
    "(use_declaration argument: (scoped_identifier) @import.module)",
    "(use_declaration argument: (identifier) @import.module)",
    "(use_declaration argument: (scoped_use_list path: (_) @import.module))",
    "(use_declaration argument: (use_as_clause path: (_) @import.module))",
    "(mod_item !body name: (identifier) @import.module)",
  ].join("\n"),
  calls: [
    "(call_expression function: (identifier) @call.name)",
    "(call_expression function: (field_expression field: (field_identifier) @call.name))",
    "(call_expression function: (scoped_identifier name: (identifier) @call.name))",
  ].join("\n"),
};

/** `crate::a::b` / `super::x` / `mod foo;` → a project file, or external. */
export function resolveRustModule(
  projectFiles: ReadonlySet<string>,
  fromFile: string,
  moduleText: string,
): string | undefined {
  const segments = moduleText.split("::").filter((segment) => segment !== "");
  if (segments.length === 0) {
    return undefined;
  }
  const fromDir = fromFile.split("/").slice(0, -1);
  // A file's own child modules live beside it, or in a directory named after
  // it when the file is a `mod.rs`/`lib.rs`/`main.rs`.
  const fileStem = (fromFile.split("/").pop() ?? "").replace(/\.rs$/, "");
  const ownDir = ["mod", "lib", "main"].includes(fileStem) ? fromDir : [...fromDir, fileStem];

  let rest = segments;
  let base: string[];
  const [head] = segments;
  if (head === "crate") {
    // `crate::` is the crate root — the directory holding lib.rs / main.rs.
    const root = [...projectFiles].find(
      (path) => path.endsWith("src/lib.rs") || path.endsWith("src/main.rs"),
    );
    base = root === undefined ? [] : root.split("/").slice(0, -1);
    rest = segments.slice(1);
  } else if (head === "self") {
    base = ownDir;
    rest = segments.slice(1);
  } else if (head === "super") {
    let climbing = segments;
    base = ownDir;
    while (climbing[0] === "super") {
      base = base.slice(0, -1);
      climbing = climbing.slice(1);
    }
    rest = climbing;
  } else {
    // A bare path is a sibling module (`mod foo;` / `use foo::Bar`) before it
    // is an external crate.
    base = ownDir;
  }

  const candidate = (parts: readonly string[]): string | undefined => {
    if (parts.length === 0) {
      return undefined;
    }
    const joined = parts.join("/");
    return [`${joined}.rs`, `${joined}/mod.rs`].find((path) => projectFiles.has(path));
  };
  // A `use` usually ends in an item name (`use crate::store::Store`), so fall
  // back to the module that would hold it, one segment at a time.
  for (let take = rest.length; take > 0; take -= 1) {
    const hit = candidate([...base, ...rest.slice(0, take)]);
    if (hit !== undefined && hit !== fromFile) {
      return hit;
    }
  }
  return undefined;
}

export interface RustWasm {
  /** Bytes of web-tree-sitter's runtime (`web-tree-sitter.wasm`). */
  runtime: Uint8Array;
  /** Bytes of the Rust grammar (`tree-sitter-rust.wasm`). */
  rust: Uint8Array;
}

/**
 * Load the grammar once (on demand — first `.rs` file), after which analysis
 * is synchronous like every adapter. See SBS-080 for the runtime contract.
 */
export async function createRustAdapter(wasm: RustWasm): Promise<LanguageAdapter> {
  const language = await loadTreeSitterLanguage(wasm.runtime, wasm.rust);
  return {
    id: "rust",
    displayName: "Rust",
    extensions: [".rs"],
    capabilities: { imports: true, callGraph: "heuristic", cfg: false, dataflow: false },
    analyze(files: readonly FileInput[], options?: AnalysisOptions): AnalysisResult {
      const paths = new Set(files.map((file) => file.path));
      return analyzeWithTreeSitter({
        files: [...files],
        language,
        queries: rustQueries,
        resolveModule: (fromFile, moduleText) => resolveRustModule(paths, fromFile, moduleText),
        cancellation: options?.cancellation,
      });
    },
  };
}
