import { describe, expect, it } from "vitest";
import { resolveRustModule, rustQueries } from "./adapter.js";

const project = (...files: string[]): ReadonlySet<string> => new Set(files);

describe("resolveRustModule", () => {
  it("resolves a sibling module declared with `mod`", () => {
    const files = project("src/lib.rs", "src/helper.rs");
    expect(resolveRustModule(files, "src/lib.rs", "helper")).toBe("src/helper.rs");
  });

  it("resolves a module directory through its mod.rs", () => {
    const files = project("src/lib.rs", "src/api/mod.rs");
    expect(resolveRustModule(files, "src/lib.rs", "api")).toBe("src/api/mod.rs");
  });

  it("resolves `crate::` against the crate root, not the current file", () => {
    const files = project("src/main.rs", "src/store.rs", "src/web/mod.rs");
    expect(resolveRustModule(files, "src/web/mod.rs", "crate::store::Store")).toBe("src/store.rs");
  });

  it("drops the trailing item name to find the module that holds it", () => {
    // `use crate::store::Store` names a type; the file is store.rs.
    const files = project("src/lib.rs", "src/store.rs");
    expect(resolveRustModule(files, "src/lib.rs", "crate::store::Store")).toBe("src/store.rs");
  });

  it("climbs one module per `super`", () => {
    const files = project("src/main.rs", "src/store/mod.rs", "src/web/mod.rs");
    expect(resolveRustModule(files, "src/web/mod.rs", "super::store::Store")).toBe(
      "src/store/mod.rs",
    );
  });

  it("resolves `self::` against the file's own module", () => {
    const files = project("src/api/mod.rs", "src/api/routes.rs");
    expect(resolveRustModule(files, "src/api/mod.rs", "self::routes")).toBe("src/api/routes.rs");
  });

  it("treats a non-mod.rs file as its own module directory", () => {
    // `src/api.rs` owns `src/api/routes.rs`.
    const files = project("src/api.rs", "src/api/routes.rs");
    expect(resolveRustModule(files, "src/api.rs", "routes")).toBe("src/api/routes.rs");
  });

  it("leaves an external crate external", () => {
    const files = project("src/lib.rs");
    expect(resolveRustModule(files, "src/lib.rs", "serde::Serialize")).toBeUndefined();
    expect(resolveRustModule(files, "src/lib.rs", "std::collections::HashMap")).toBeUndefined();
  });

  it("never resolves a file to itself", () => {
    const files = project("src/store.rs");
    expect(resolveRustModule(files, "src/store.rs", "store")).toBeUndefined();
  });

  it("returns nothing for an empty path", () => {
    expect(resolveRustModule(project("src/lib.rs"), "src/lib.rs", "")).toBeUndefined();
  });

  it("falls back to a root-relative path when the crate has no lib.rs or main.rs", () => {
    // A crate root is how `crate::` is anchored; without one (a fixture, a
    // snippet) the path is tried from the top rather than guessed at.
    const files = project("store.rs");
    expect(resolveRustModule(files, "other.rs", "crate::store")).toBe("store.rs");
  });

  it("resolves a multi-segment path through nested module directories", () => {
    const files = project("src/lib.rs", "src/api/routes/health.rs");
    expect(resolveRustModule(files, "src/lib.rs", "crate::api::routes::health::check")).toBe(
      "src/api/routes/health.rs",
    );
  });
});

describe("rustQueries", () => {
  it("captures the impl block as the container that holds methods", () => {
    // The design decision: `impl Foo { fn bar() }` means methods do not nest
    // inside the type declaration, so the impl block is the class-kind parent.
    expect(rustQueries.structure).toContain("(impl_item type: (type_identifier) @class.name)");
    expect(rustQueries.structure).toContain("generic_type type: (type_identifier) @class.name");
  });

  it("captures every type-declaring item", () => {
    for (const item of ["struct_item", "enum_item", "trait_item", "union_item", "mod_item"]) {
      expect(rustQueries.structure).toContain(item);
    }
  });

  it("captures bodiless trait method signatures as declarations", () => {
    expect(rustQueries.structure).toContain("function_signature_item");
  });

  it("captures plain, method and path calls", () => {
    expect(rustQueries.calls).toContain("(call_expression function: (identifier) @call.name)");
    expect(rustQueries.calls).toContain("field_expression field: (field_identifier) @call.name");
    expect(rustQueries.calls).toContain("scoped_identifier name: (identifier) @call.name");
  });

  it("uses only the capture names the mapper contract defines", () => {
    const captures = [rustQueries.structure, rustQueries.imports, rustQueries.calls]
      .join("\n")
      .matchAll(/@([\w.]+)/g);
    for (const [, name] of captures) {
      expect([
        "class.def",
        "class.name",
        "function.def",
        "function.name",
        "import.module",
        "call.name",
      ]).toContain(name);
    }
  });
});
