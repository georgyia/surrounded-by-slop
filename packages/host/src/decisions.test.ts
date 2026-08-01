import { describe, expect, it } from "vitest";
import { expandBraces, isTestFile, looksMinified } from "./decisions.js";

describe("isTestFile", () => {
  it.each([
    "src/app.test.ts",
    "src/app.spec.tsx",
    "test_app.py",
    "src/app_test.py",
    "__tests__/helper.ts",
    "src/tests/helper.ts",
    "Spec/helper.ts",
  ])("classifies %s as test code", (path) => {
    expect(isTestFile(path)).toBe(true);
  });

  it.each([
    "src/contests/helper.ts",
    "src/mytests/helper.ts",
    "src/tests-integration/helper.ts",
    "src/attestations/helper.ts",
    "src/specs/helper.ts",
  ])("does not over-match %s", (path) => {
    expect(isTestFile(path)).toBe(false);
  });
});

describe("looksMinified", () => {
  it("ignores small one-line source and rejects large one-line bundles", () => {
    expect(looksMinified("export const value = 1;")).toBe(false);
    expect(looksMinified(`const value=1;${"/*pad*/".repeat(4_000)}`)).toBe(true);
  });
});

describe("expandBraces", () => {
  it("expands the source-extension include pattern", () => {
    expect(expandBraces("**/*.{ts,tsx,py}")).toEqual(["**/*.ts", "**/*.tsx", "**/*.py"]);
  });
});
