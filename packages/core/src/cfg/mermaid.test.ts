import { describe, expect, it } from "vitest";
import { extractControlFlow } from "./builder.js";
import { cfgToMermaid } from "./mermaid.js";
import type { ControlFlowGraph } from "./types.js";

function cfgOf(source: string): ControlFlowGraph {
  const { cfgs } = extractControlFlow({ path: "m.ts", text: source });
  const cfg = cfgs[0];
  if (cfg === undefined) {
    throw new Error("no cfg extracted");
  }
  return cfg;
}

describe("cfgToMermaid", () => {
  it("renders every block and every edge of the CFG — the view's exact structure", () => {
    const cfg = cfgOf(
      "function f(n: number) {\n  if (n > 0) {\n    return n;\n  }\n  return -n;\n}\n",
    );
    const mermaid = cfgToMermaid(cfg);
    expect(mermaid.startsWith("flowchart TD")).toBe(true);
    for (const block of cfg.blocks) {
      expect(mermaid).toContain(block.id);
    }
    for (const edge of cfg.edges) {
      expect(mermaid).toContain(`${edge.from} `);
      expect(mermaid).toContain(` ${edge.to}`);
    }
    expect(mermaid).toContain("([Start])");
    expect(mermaid).toContain("([End])");
    expect(mermaid).toContain("|true|");
    expect(mermaid).toContain("|false|");
  });

  it("labels case dispatch and dots loop/exception/finally links", () => {
    const cfg = cfgOf(
      'function f(k: string) {\n  for (const c of k) {\n    switch (c) {\n      case "x":\n        return 1;\n    }\n  }\n  try {\n    return risky();\n  } finally {\n    done();\n  }\n}\ndeclare function risky(): number; declare function done(): void;\n',
    );
    const mermaid = cfgToMermaid(cfg);
    expect(mermaid).toContain("|#quot;x#quot;|");
    expect(mermaid).toContain("|no match|");
    expect(mermaid).toContain("-.->|loop|");
    // The early return re-routes through the finally — that edge is the dotted one.
    expect(mermaid).toContain("-.->|finally|");
  });

  it("escapes quotes in statement text and marks awaiting blocks", () => {
    const cfg = cfgOf(
      'async function f() {\n  const a = await load("x");\n  return a;\n}\ndeclare function load(k: string): Promise<number>;\n',
    );
    const mermaid = cfgToMermaid(cfg);
    expect(mermaid).toContain("#quot;x#quot;");
    expect(mermaid).not.toContain('load("x")');
    expect(mermaid).toContain("⏳");
  });
});
