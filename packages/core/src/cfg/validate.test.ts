import { describe, expect, it } from "vitest";
import type { SourceSpan } from "../ir/types.js";
import type { CfgBlock, CfgEdge, ControlFlowGraph } from "./types.js";
import { validateCfg } from "./validate.js";

const at = (startLine: number, startCol: number, endLine: number, endCol: number): SourceSpan => ({
  file: "a.ts",
  startLine,
  startCol,
  endLine,
  endCol,
});

/**
 * A minimal well-formed CFG — entry → b1 → exit — handed back with named
 * references so each test can bend exactly one rule without index access.
 */
function validCfg(): {
  cfg: ControlFlowGraph;
  entry: CfgBlock;
  b1: CfgBlock;
  entryEdge: CfgEdge;
} {
  const entry: CfgBlock = { id: "entry", kind: "entry", statements: [], spans: [] };
  const b1: CfgBlock = {
    id: "b1",
    kind: "basic",
    statements: ["x = 1"],
    spans: [at(2, 2, 2, 8)],
  };
  const exit: CfgBlock = { id: "exit", kind: "exit", statements: [], spans: [] };
  const entryEdge: CfgEdge = { from: "entry", to: "b1", kind: "normal" };
  const cfg: ControlFlowGraph = {
    name: "fn",
    span: at(1, 0, 10, 1),
    entryId: "entry",
    exitId: "exit",
    blocks: [entry, b1, exit],
    edges: [entryEdge, { from: "b1", to: "exit", kind: "normal" }],
  };
  return { cfg, entry, b1, entryEdge };
}

describe("validateCfg", () => {
  it("accepts a well-formed graph", () => {
    expect(validateCfg(validCfg().cfg)).toEqual([]);
  });

  it("accepts a case edge carrying a label", () => {
    const { cfg } = validCfg();
    cfg.edges = [
      { from: "entry", to: "b1", kind: "case", label: "1" },
      { from: "b1", to: "exit", kind: "normal" },
    ];
    expect(validateCfg(cfg)).toEqual([]);
  });

  it("accepts a multi-line span that starts right of where it ends", () => {
    // Ordering is line-first: column only decides within a single line.
    const { cfg, b1 } = validCfg();
    b1.spans = [at(2, 40, 3, 2)];
    expect(validateCfg(cfg)).toEqual([]);
  });

  describe("blocks", () => {
    it("reports duplicate block ids", () => {
      const { cfg } = validCfg();
      cfg.blocks.push({ id: "b1", kind: "basic", statements: [], spans: [] });
      expect(validateCfg(cfg)).toContain("duplicate block id b1");
    });

    it("reports a statement/span count mismatch", () => {
      const { cfg, b1 } = validCfg();
      b1.statements = ["x = 1", "y = 2"];
      expect(validateCfg(cfg)).toContain("block b1 has 2 statements but 1 spans");
    });

    it("requires entry and exit blocks to be empty", () => {
      const { cfg, entry } = validCfg();
      entry.statements = ["x = 1"];
      entry.spans = [at(2, 2, 2, 8)];
      expect(validateCfg(cfg)).toContain("entry block entry must be empty");
    });

    it("reports an inverted span within one line", () => {
      const { cfg, b1 } = validCfg();
      b1.spans = [at(2, 9, 2, 3)];
      expect(validateCfg(cfg)).toContain("block b1 has an inverted span (2:9)");
    });

    it("reports a span whose end line precedes its start", () => {
      const { cfg, b1 } = validCfg();
      b1.spans = [at(5, 0, 3, 0)];
      expect(validateCfg(cfg)).toContain("block b1 has an inverted span (5:0)");
    });

    it("reports a span reaching outside the function", () => {
      const { cfg, b1 } = validCfg();
      b1.spans = [at(2, 0, 99, 0)];
      expect(validateCfg(cfg)).toContain("block b1 maps outside its function (2)");
    });
  });

  describe("entry and exit", () => {
    it("rejects a second entry block", () => {
      const { cfg } = validCfg();
      cfg.blocks.push({ id: "entry2", kind: "entry", statements: [], spans: [] });
      expect(validateCfg(cfg)).toContain("expected exactly one entry block, found 2");
    });

    it("rejects a missing entry block", () => {
      const { cfg } = validCfg();
      cfg.blocks = cfg.blocks.filter((block) => block.kind !== "entry");
      const problems = validateCfg(cfg);
      expect(problems).toContain("expected exactly one entry block, found 0");
      expect(problems).toContain("entryId entry is not a block");
    });

    it("rejects a second exit block", () => {
      const { cfg } = validCfg();
      cfg.blocks.push({ id: "exit2", kind: "exit", statements: [], spans: [] });
      expect(validateCfg(cfg)).toContain("expected exactly one exit block, found 2");
    });

    it("rejects an exitId that names no block", () => {
      const { cfg } = validCfg();
      cfg.exitId = "nowhere";
      expect(validateCfg(cfg)).toContain("exitId nowhere is not a block");
    });
  });

  describe("edges", () => {
    it("reports an edge from an unknown block", () => {
      const { cfg } = validCfg();
      cfg.edges.push({ from: "ghost", to: "exit", kind: "normal" });
      expect(validateCfg(cfg)).toContain("edge from unknown block ghost");
    });

    it("reports an edge to an unknown block", () => {
      const { cfg } = validCfg();
      cfg.edges.push({ from: "b1", to: "ghost", kind: "normal" });
      expect(validateCfg(cfg)).toContain("edge to unknown block ghost");
    });

    it("rejects an edge back into the entry block", () => {
      const { cfg } = validCfg();
      cfg.edges.push({ from: "b1", to: "entry", kind: "back" });
      expect(validateCfg(cfg)).toContain("entry block has an incoming edge");
    });

    it("rejects an edge leaving the exit block", () => {
      const { cfg } = validCfg();
      cfg.edges.push({ from: "exit", to: "b1", kind: "normal" });
      expect(validateCfg(cfg)).toContain("exit block has an outgoing edge");
    });

    it("reports duplicate edges", () => {
      const { cfg } = validCfg();
      cfg.edges.push({ from: "entry", to: "b1", kind: "normal" });
      expect(validateCfg(cfg)).toContain("duplicate edge entry→b1:normal:");
    });

    it("allows same-pair edges that differ by kind", () => {
      const { cfg } = validCfg();
      cfg.edges.push({ from: "entry", to: "b1", kind: "true" });
      expect(validateCfg(cfg)).toEqual([]);
    });

    it("rejects a label on a non-case edge", () => {
      const { cfg, entryEdge } = validCfg();
      entryEdge.label = "yes";
      expect(validateCfg(cfg)).toContain(
        "edge entry→b1:normal:yes carries a label but is not a case edge",
      );
    });
  });

  it("collects every problem rather than stopping at the first", () => {
    const { cfg } = validCfg();
    cfg.exitId = "nowhere";
    cfg.edges.push({ from: "ghost", to: "b1", kind: "normal" });
    expect(validateCfg(cfg).length).toBeGreaterThan(1);
  });
});
