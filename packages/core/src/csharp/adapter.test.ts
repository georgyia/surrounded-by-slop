import { describe, expect, it } from "vitest";
import { csharpQueries } from "./adapter.js";

describe("csharpQueries", () => {
  it("captures both namespace forms", () => {
    expect(csharpQueries.structure).toContain("(namespace_declaration name: (identifier)");
    expect(csharpQueries.structure).toContain("(file_scoped_namespace_declaration name:");
  });

  it("captures dotted namespace names, not just single identifiers", () => {
    // `namespace Shop.Api` arrives as a qualified_name, not an identifier.
    expect(csharpQueries.structure).toContain("(qualified_name) @namespace.name");
  });

  it("uses the namespace kind, so a namespace is a container without being a type", () => {
    expect(csharpQueries.structure).toContain("@namespace.def");
    // A method is what nests inside a *class*; the namespace must not claim it.
    expect(csharpQueries.structure).not.toContain("@class.def) @namespace");
  });

  it("captures every type-declaring form", () => {
    for (const form of [
      "class_declaration",
      "interface_declaration",
      "struct_declaration",
      "enum_declaration",
      "record_declaration",
    ]) {
      expect(csharpQueries.structure).toContain(form);
    }
  });

  it("captures methods, constructors and local functions", () => {
    expect(csharpQueries.structure).toContain("(method_declaration name: (identifier)");
    expect(csharpQueries.structure).toContain("(constructor_declaration name: (identifier)");
    expect(csharpQueries.structure).toContain("(local_function_statement name: (identifier)");
  });

  it("captures both using forms", () => {
    expect(csharpQueries.imports).toContain("(using_directive (qualified_name) @import.module)");
    expect(csharpQueries.imports).toContain("(using_directive (identifier) @import.module)");
  });

  it("captures plain, member and constructor calls", () => {
    expect(csharpQueries.calls).toContain("(invocation_expression function: (identifier)");
    expect(csharpQueries.calls).toContain("member_access_expression name: (identifier)");
    expect(csharpQueries.calls).toContain("object_creation_expression");
  });

  it("uses only the capture names the mapper contract defines", () => {
    const captures = [csharpQueries.structure, csharpQueries.imports, csharpQueries.calls]
      .join("\n")
      .matchAll(/@([\w.]+)/g);
    for (const [, name] of captures) {
      expect([
        "class.def",
        "class.name",
        "function.def",
        "function.name",
        "namespace.def",
        "namespace.name",
        "import.module",
        "call.name",
      ]).toContain(name);
    }
  });
});
