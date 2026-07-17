import { describe, expect, it } from "vitest";
import { isAnalyzablePath, normalizeRelativePath, toRelativePath, toVirtualPath } from "./host.js";

describe("path handling", () => {
  it("normalizes separators and leading ./", () => {
    expect(normalizeRelativePath("src\\a\\b.ts")).toBe("src/a/b.ts");
    expect(normalizeRelativePath("./src/a.ts")).toBe("src/a.ts");
    expect(normalizeRelativePath("././a.ts")).toBe("a.ts");
    expect(normalizeRelativePath("a.ts")).toBe("a.ts");
  });

  it("maps between virtual and relative paths", () => {
    expect(toVirtualPath("src/a.ts")).toBe("/src/a.ts");
    expect(toRelativePath("/src/a.ts")).toBe("src/a.ts");
    expect(toRelativePath("src/a.ts")).toBe("src/a.ts");
  });

  it("recognizes analyzable extensions case-insensitively", () => {
    expect(isAnalyzablePath("a.ts")).toBe(true);
    expect(isAnalyzablePath("a.TSX")).toBe(true);
    expect(isAnalyzablePath("a.js")).toBe(true);
    expect(isAnalyzablePath("a.jsx")).toBe(true);
    expect(isAnalyzablePath("a.css")).toBe(false);
    expect(isAnalyzablePath("Makefile")).toBe(false);
  });

  it("accepts every extension the workspace scan is told to collect", () => {
    // slop.include ships `**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,py}`, so the
    // extension hands all of these to this adapter. Anything rejected here is
    // dropped from the program and vanishes from the map with no diagnostic.
    for (const path of ["a.ts", "a.tsx", "a.mts", "a.cts", "a.js", "a.jsx", "a.mjs", "a.cjs"]) {
      expect(isAnalyzablePath(path), path).toBe(true);
    }
    expect(isAnalyzablePath("a.MJS")).toBe(true);
  });
});
