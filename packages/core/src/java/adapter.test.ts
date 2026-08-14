import { describe, expect, it } from "vitest";
import { javaQueries, resolveJavaImport } from "./adapter.js";

const project = (...files: string[]): ReadonlySet<string> => new Set(files);

describe("resolveJavaImport", () => {
  it("resolves a package path to its file", () => {
    const files = project("com/example/Helper.java", "com/example/Main.java");
    expect(resolveJavaImport(files, "com/example/Main.java", "com.example.Helper")).toBe(
      "com/example/Helper.java",
    );
  });

  it("looks through a build-tool source root, which is not part of the import", () => {
    const files = project("src/main/java/com/shop/store/OrderRepository.java");
    expect(
      resolveJavaImport(
        files,
        "src/main/java/com/shop/api/X.java",
        "com.shop.store.OrderRepository",
      ),
    ).toBe("src/main/java/com/shop/store/OrderRepository.java");
  });

  it("leaves a JDK or third-party type external", () => {
    expect(resolveJavaImport(project("Main.java"), "Main.java", "java.util.List")).toBeUndefined();
  });

  it("leaves a wildcard import external — it names a package, not a type", () => {
    const files = project("com/example/Helper.java");
    expect(resolveJavaImport(files, "Main.java", "com.example.*")).toBeUndefined();
  });

  it("picks the same file every time when several source roots match", () => {
    const files = project("src/test/java/com/shop/Thing.java", "src/main/java/com/shop/Thing.java");
    const resolve = (): string | undefined =>
      resolveJavaImport(files, "Main.java", "com.shop.Thing");
    // Shortest path, then alphabetical: deterministic across runs and platforms.
    expect(resolve()).toBe("src/main/java/com/shop/Thing.java");
    expect(resolve()).toBe(resolve());
  });

  it("prefers an exact path over a suffix match", () => {
    const files = project("com/shop/Thing.java", "src/main/java/com/shop/Thing.java");
    expect(resolveJavaImport(files, "Main.java", "com.shop.Thing")).toBe("com/shop/Thing.java");
  });
});

describe("javaQueries", () => {
  it("captures every type declaration form as a class-like container", () => {
    for (const form of [
      "class_declaration",
      "interface_declaration",
      "enum_declaration",
      "record_declaration",
    ]) {
      expect(javaQueries.structure).toContain(form);
    }
  });

  it("captures methods and constructors, which nest inside their type", () => {
    expect(javaQueries.structure).toContain(
      "(method_declaration name: (identifier) @function.name)",
    );
    expect(javaQueries.structure).toContain(
      "(constructor_declaration name: (identifier) @function.name)",
    );
  });

  it("captures invocations and constructor calls", () => {
    expect(javaQueries.calls).toContain("(method_invocation name: (identifier) @call.name)");
    expect(javaQueries.calls).toContain("object_creation_expression");
  });

  it("uses only the capture names the mapper contract defines", () => {
    const captures = [javaQueries.structure, javaQueries.imports, javaQueries.calls]
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
