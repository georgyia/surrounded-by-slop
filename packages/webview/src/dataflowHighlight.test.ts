import {
  type ControlFlowGraph,
  dataflowForSpan,
  extractControlFlow,
  extractDataflow,
  type FunctionDataflow,
} from "@surrounded-by-slop/core";
import { describe, expect, it } from "vitest";
import { highlightForVariable } from "./dataflowHighlight.js";

const SOURCE =
  "function f(n: number): number {\n  let total = 0;\n  while (n > 0) {\n    total += n;\n    n -= 1;\n  }\n  return total;\n}\n";

function extract(): { cfg: ControlFlowGraph; dataflow: FunctionDataflow } {
  const cfg = extractControlFlow({ path: "h.ts", text: SOURCE }).cfgs[0];
  if (cfg === undefined) {
    throw new Error("no cfg");
  }
  const dataflow = dataflowForSpan(
    extractDataflow({ path: "h.ts", text: SOURCE }).functions,
    cfg.span,
  );
  if (dataflow === undefined) {
    throw new Error("no dataflow");
  }
  return { cfg, dataflow };
}

describe("highlightForVariable", () => {
  it("maps a variable's writes and reads onto the blocks that contain them", () => {
    const { cfg, dataflow } = extract();
    const total = dataflow.variables.find((variable) => variable.name === "total");
    expect(total).toBeDefined();
    const highlight = highlightForVariable(cfg, dataflow, total?.id ?? "");
    expect(highlight).toBeDefined();

    const blockWith = (text: string) =>
      cfg.blocks.find((block) => block.statements.some((s) => s.includes(text)))?.id ?? "";
    // Written at its declaration and inside the loop body…
    expect(highlight?.writes.has(blockWith("let total = 0"))).toBe(true);
    expect(highlight?.writes.has(blockWith("total += n"))).toBe(true);
    // …read in the loop body (compound) and at the return.
    expect(highlight?.reads.has(blockWith("total += n"))).toBe(true);
    expect(highlight?.reads.has(blockWith("return total"))).toBe(true);
    // The condition block only touches n, never total.
    expect(highlight?.reads.has(blockWith("n > 0"))).toBe(false);
    expect(highlight?.writes.has(blockWith("n > 0"))).toBe(false);
  });

  it("returns undefined for an unknown variable id", () => {
    const { cfg, dataflow } = extract();
    expect(highlightForVariable(cfg, dataflow, "ghost@1:1")).toBeUndefined();
  });
});
