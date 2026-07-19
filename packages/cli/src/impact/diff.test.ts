import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "./diff.js";

const lines = (diff: string, file: string): number[] =>
  [...(parseUnifiedDiff(diff).get(file) ?? [])].sort((a, b) => a - b);

describe("parseUnifiedDiff", () => {
  it("records added lines against the new file", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -5,0 +6,2 @@",
      "+const x = 1;",
      "+const y = 2;",
    ].join("\n");
    expect(lines(diff, "src/a.ts")).toEqual([6, 7]);
  });

  it("attributes a deletion to its position in the new file", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -10 +9,0 @@",
      "-gone();",
    ].join("\n");
    expect(lines(diff, "src/a.ts")).toEqual([9]);
  });

  it("marks every line of a new file", () => {
    const diff = [
      "diff --git a/src/new.ts b/src/new.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/src/new.ts",
      "@@ -0,0 +1,2 @@",
      "+export const a = 1;",
      "+export const b = 2;",
    ].join("\n");
    expect(lines(diff, "src/new.ts")).toEqual([1, 2]);
  });

  it("ignores a deleted file (target is /dev/null)", () => {
    const diff = [
      "diff --git a/src/gone.ts b/src/gone.ts",
      "deleted file mode 100644",
      "--- a/src/gone.ts",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-export const a = 1;",
      "-export const b = 2;",
    ].join("\n");
    expect(parseUnifiedDiff(diff).has("/dev/null")).toBe(false);
    expect(parseUnifiedDiff(diff).size).toBe(0);
  });

  it("produces nothing for a rename without content changes", () => {
    const diff = [
      "diff --git a/src/old.ts b/src/new.ts",
      "similarity index 100%",
      "rename from src/old.ts",
      "rename to src/new.ts",
    ].join("\n");
    expect(parseUnifiedDiff(diff).size).toBe(0);
  });

  it("produces nothing for a mode-only change", () => {
    const diff = ["diff --git a/run.sh b/run.sh", "old mode 100644", "new mode 100755"].join("\n");
    expect(parseUnifiedDiff(diff).size).toBe(0);
  });

  it("handles multiple files and multiple hunks", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "@@ -10,0 +11 @@",
      "+added",
      "diff --git a/src/b.ts b/src/b.ts",
      "--- a/src/b.ts",
      "+++ b/src/b.ts",
      "@@ -3,0 +4 @@",
      "+more",
    ].join("\n");
    expect(lines(diff, "src/a.ts")).toEqual([1, 11]);
    expect(lines(diff, "src/b.ts")).toEqual([4]);
  });
});
