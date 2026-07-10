import { describe, expect, it } from "vitest";
import { globToRegExp, matchesAnyGlob } from "./glob.js";

describe("globToRegExp", () => {
  it("matches * within a segment only", () => {
    expect(globToRegExp("src/*.ts").test("src/a.ts")).toBe(true);
    expect(globToRegExp("src/*.ts").test("src/deep/a.ts")).toBe(false);
  });

  it("matches ** across segments, including zero", () => {
    expect(globToRegExp("src/**/*.ts").test("src/a.ts")).toBe(true);
    expect(globToRegExp("src/**/*.ts").test("src/deep/nested/a.ts")).toBe(true);
    expect(globToRegExp("**/*.test.ts").test("a.test.ts")).toBe(true);
    expect(globToRegExp("**").test("anything/at/all.ts")).toBe(true);
  });

  it("matches ? as exactly one non-separator character", () => {
    expect(globToRegExp("a?.ts").test("ab.ts")).toBe(true);
    expect(globToRegExp("a?.ts").test("a.ts")).toBe(false);
    expect(globToRegExp("a?.ts").test("a/.ts")).toBe(false);
  });

  it("escapes regex metacharacters literally", () => {
    expect(globToRegExp("a+b(c).ts").test("a+b(c).ts")).toBe(true);
    expect(globToRegExp("a.ts").test("axts")).toBe(false);
  });
});

describe("matchesAnyGlob", () => {
  it("returns true when any pattern matches", () => {
    expect(matchesAnyGlob("src/a.ts", ["lib/**", "src/**"])).toBe(true);
    expect(matchesAnyGlob("src/a.ts", ["lib/**"])).toBe(false);
    expect(matchesAnyGlob("src/a.ts", [])).toBe(false);
  });
});
