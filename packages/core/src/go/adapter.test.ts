import { describe, expect, it } from "vitest";
import { goQueries, normalizeGoImport } from "./adapter.js";

describe("normalizeGoImport", () => {
  it("strips the quotes the grammar hands back with the literal", () => {
    expect(normalizeGoImport('"fmt"')).toBe("fmt");
    expect(normalizeGoImport('"example.com/app/store"')).toBe("example.com/app/store");
  });

  it("strips backticks too, since a raw string literal is a legal import path", () => {
    expect(normalizeGoImport("`fmt`")).toBe("fmt");
  });

  it("leaves an already-bare path alone", () => {
    expect(normalizeGoImport("fmt")).toBe("fmt");
  });
});

describe("goQueries", () => {
  it("captures both plain functions and methods, since methods are not nested", () => {
    // A Go method sits beside its type rather than inside it, so span nesting
    // cannot derive method-ness — both forms must produce @function captures.
    expect(goQueries.structure).toContain(
      "(function_declaration name: (identifier) @function.name)",
    );
    expect(goQueries.structure).toContain(
      "(method_declaration name: (field_identifier) @function.name)",
    );
  });

  it("treats a named type as the class-like container", () => {
    expect(goQueries.structure).toContain("type_spec name: (type_identifier) @class.name");
  });

  it("captures both string-literal forms an import path can take", () => {
    expect(goQueries.imports).toContain("interpreted_string_literal");
    expect(goQueries.imports).toContain("raw_string_literal");
  });

  it("captures bare and selector calls", () => {
    expect(goQueries.calls).toContain("(call_expression function: (identifier) @call.name)");
    expect(goQueries.calls).toContain("selector_expression field: (field_identifier) @call.name");
  });

  it("uses only the capture names the mapper contract defines", () => {
    const captures = [goQueries.structure, goQueries.imports, goQueries.calls]
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
