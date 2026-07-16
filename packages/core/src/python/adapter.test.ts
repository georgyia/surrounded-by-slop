import { describe, expect, it } from "vitest";
import { pythonQueries, resolvePythonModule } from "./adapter.js";

const project = (...files: string[]): ReadonlySet<string> => new Set(files);

describe("resolvePythonModule", () => {
  describe("absolute imports", () => {
    it("resolves a dotted module to its file", () => {
      const files = project("shop/cart.py", "shop/__init__.py");
      expect(resolvePythonModule(files, "main.py", "shop.cart")).toBe("shop/cart.py");
    });

    it("resolves a package to its __init__.py", () => {
      const files = project("shop/__init__.py");
      expect(resolvePythonModule(files, "main.py", "shop")).toBe("shop/__init__.py");
    });

    it("prefers the module file over a same-named package", () => {
      const files = project("shop.py", "shop/__init__.py");
      expect(resolvePythonModule(files, "main.py", "shop")).toBe("shop.py");
    });

    it("leaves a stdlib or third-party module unresolved", () => {
      expect(resolvePythonModule(project("main.py"), "main.py", "os.path")).toBeUndefined();
    });
  });

  describe("relative imports", () => {
    it("resolves a single dot against the file's own package", () => {
      const files = project("shop/cart.py", "shop/models.py");
      expect(resolvePythonModule(files, "shop/cart.py", ".models")).toBe("shop/models.py");
    });

    it("climbs one package per extra dot", () => {
      const files = project("shop/api/views.py", "shop/models.py");
      expect(resolvePythonModule(files, "shop/api/views.py", "..models")).toBe("shop/models.py");
    });

    it("climbs two packages for three dots", () => {
      const files = project("a/b/c/mod.py", "a/shared.py");
      expect(resolvePythonModule(files, "a/b/c/mod.py", "...shared")).toBe("a/shared.py");
    });

    it("resolves a bare dot to the package's __init__.py", () => {
      const files = project("shop/cart.py", "shop/__init__.py");
      expect(resolvePythonModule(files, "shop/cart.py", ".")).toBe("shop/__init__.py");
    });

    it("falls back to the package when the submodule does not exist", () => {
      // `from .helpers import x` where helpers is a name re-exported by __init__.
      const files = project("shop/cart.py", "shop/__init__.py");
      expect(resolvePythonModule(files, "shop/cart.py", ".helpers")).toBe("shop/__init__.py");
    });

    it("returns undefined when more dots than packages escape the project", () => {
      const files = project("mod.py", "other.py");
      expect(resolvePythonModule(files, "mod.py", "...other")).toBeUndefined();
    });

    it("returns undefined for a bare dot at the project root", () => {
      // No package to resolve against: the candidate base is empty.
      expect(resolvePythonModule(project("mod.py"), "mod.py", ".")).toBeUndefined();
    });

    it("returns undefined when the relative target is missing entirely", () => {
      const files = project("shop/cart.py");
      expect(resolvePythonModule(files, "shop/cart.py", ".ghost")).toBeUndefined();
    });
  });
});

describe("pythonQueries", () => {
  it("captures the names the mapper contract requires", () => {
    const all = [pythonQueries.structure, pythonQueries.imports, pythonQueries.calls].join("\n");
    for (const capture of [
      "@class.def",
      "@class.name",
      "@function.def",
      "@function.name",
      "@import.module",
      "@call.name",
    ]) {
      expect(all).toContain(capture);
    }
  });
});
