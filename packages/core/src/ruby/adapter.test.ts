import { describe, expect, it } from "vitest";
import { resolveRubyRequire, rubyQueries } from "./adapter.js";

const project = (...files: string[]): ReadonlySet<string> => new Set(files);

describe("resolveRubyRequire", () => {
  it("resolves a sibling file", () => {
    const files = project("main.rb", "store.rb");
    expect(resolveRubyRequire(files, "main.rb", "store")).toBe("store.rb");
  });

  it("resolves an explicit ./ prefix", () => {
    const files = project("app/main.rb", "app/store.rb");
    expect(resolveRubyRequire(files, "app/main.rb", "./store")).toBe("app/store.rb");
  });

  it("climbs out of the directory with ../", () => {
    const files = project("app/controller.rb", "lib/repository.rb");
    expect(resolveRubyRequire(files, "app/controller.rb", "../lib/repository")).toBe(
      "lib/repository.rb",
    );
  });

  it("accepts a path that already ends in .rb", () => {
    const files = project("main.rb", "store.rb");
    expect(resolveRubyRequire(files, "main.rb", "store.rb")).toBe("store.rb");
  });

  it("falls back to a project-root-relative path", () => {
    // `require "lib/store"` with lib on the load path.
    const files = project("app/main.rb", "lib/store.rb");
    expect(resolveRubyRequire(files, "app/main.rb", "lib/store")).toBe("lib/store.rb");
  });

  it("leaves a gem external — it names no file we analyze", () => {
    const files = project("main.rb");
    expect(resolveRubyRequire(files, "main.rb", "json")).toBeUndefined();
    expect(resolveRubyRequire(files, "main.rb", "net/http")).toBeUndefined();
  });

  it("never resolves a file to itself", () => {
    expect(resolveRubyRequire(project("store.rb"), "store.rb", "store")).toBeUndefined();
  });

  it("returns nothing for an empty or dot-only path", () => {
    const files = project("main.rb");
    expect(resolveRubyRequire(files, "main.rb", "")).toBeUndefined();
    expect(resolveRubyRequire(files, "main.rb", "./")).toBeUndefined();
  });
});

describe("rubyQueries", () => {
  it("captures classes and modules, which nest to give qualified names", () => {
    expect(rubyQueries.structure).toContain("(class name: (constant) @class.name)");
    expect(rubyQueries.structure).toContain("(module name: (constant) @class.name)");
  });

  it("captures compact `class A::B` declarations", () => {
    expect(rubyQueries.structure).toContain("scope_resolution name: (constant) @class.name");
  });

  it("captures instance, singleton and setter methods", () => {
    expect(rubyQueries.structure).toContain("(method name: (identifier) @function.name)");
    expect(rubyQueries.structure).toContain("(singleton_method name: (identifier) @function.name)");
    expect(rubyQueries.structure).toContain("(method name: (setter) @function.name)");
  });

  it("captures the require argument as the import path", () => {
    expect(rubyQueries.imports).toContain("string_content) @import.module");
  });

  it("uses only the capture names the mapper contract defines, plus ignored `_` ones", () => {
    const captures = [rubyQueries.structure, rubyQueries.imports, rubyQueries.calls]
      .join("\n")
      .matchAll(/@([\w.]+)/g);
    for (const [, name] of captures) {
      if (name === undefined || name.startsWith("_")) {
        continue; // conventionally-ignored capture, dropped by the mapper
      }
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
