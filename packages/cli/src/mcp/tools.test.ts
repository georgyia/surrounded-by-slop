import { analyzeTypeScriptProject } from "@surrounded-by-slop/core";
import { describe, expect, it } from "vitest";
import { callTool, type ToolContext } from "./tools.js";

const { graph } = analyzeTypeScriptProject([
  {
    path: "src/orders.ts",
    text: [
      "export function money(n: number) { return n; }",
      "export function place() { return money(1); }",
    ].join("\n"),
  },
]);

const ctx: ToolContext = {
  graph: () => graph,
  graphWithTests: () => graph,
  gitDiff: () => "",
};

describe("callTool", () => {
  it("runs repo_map", () => {
    const result = callTool(ctx, "repo_map", {});
    expect(result?.text).toContain("# repo map");
  });

  it("runs callers", () => {
    const result = callTool(ctx, "callers", { symbol: "money" });
    expect(result?.text).toContain("place");
  });

  it("marks a resolution failure as an error", () => {
    const result = callTool(ctx, "callers", { symbol: "ghost" });
    expect(result?.isError).toBe(true);
  });

  it("reports a missing required argument as an error", () => {
    const result = callTool(ctx, "callers", {});
    expect(result?.isError).toBe(true);
    expect(result?.text).toContain("missing required argument");
  });

  it("runs impact from a supplied diff", () => {
    const diff = [
      "diff --git a/src/orders.ts b/src/orders.ts",
      "--- a/src/orders.ts",
      "+++ b/src/orders.ts",
      "@@ -1 +1 @@",
      "-export function money(n: number) { return n; }",
      "+export function money(n: number) { return n + 0; }",
    ].join("\n");
    const result = callTool(ctx, "impact", { diff });
    expect(result?.text).toContain("changed:");
    expect(result?.text).toContain("money");
  });

  it("returns undefined for an unknown tool", () => {
    expect(callTool(ctx, "frobnicate", {})).toBeUndefined();
  });

  it("caps oversized responses with a truncation notice", () => {
    // A large synthetic project makes repo_map exceed the 1500-token ceiling.
    const text = Array.from(
      { length: 400 },
      (_, i) => `export function fn_number_${i}(argument: number): number { return argument; }`,
    ).join("\n");
    const { graph: big } = analyzeTypeScriptProject([{ path: "src/big.ts", text }]);
    const bigCtx: ToolContext = { graph: () => big, graphWithTests: () => big, gitDiff: () => "" };
    const result = callTool(bigCtx, "repo_map", { budget: 9000 });
    expect(result?.text).toContain("truncated");
  });
});
