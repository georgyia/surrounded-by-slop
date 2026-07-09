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
});
