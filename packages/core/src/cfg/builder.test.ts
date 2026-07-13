import { describe, expect, it } from "vitest";
import { cfgAtLine, extractControlFlow } from "./builder.js";
import { reachableCfgBlocks } from "./queries.js";
import type { ControlFlowGraph } from "./types.js";
import { validateCfg } from "./validate.js";

function only(source: string): ControlFlowGraph {
  const { cfgs, diagnostics } = extractControlFlow({ path: "case.ts", text: source });
  expect(diagnostics).toEqual([]);
  expect(cfgs.length).toBe(1);
  const cfg = cfgs[0] as ControlFlowGraph;
  expect(validateCfg(cfg)).toEqual([]);
  return cfg;
}

function edgeKinds(cfg: ControlFlowGraph): string[] {
  return cfg.edges.map((edge) => edge.kind);
}

describe("extractControlFlow", () => {
  it("builds entry → statements → exit for straight-line code", () => {
    const cfg = only("function f() {\n  const a = 1;\n  const b = a + 1;\n}\n");
    expect(cfg.blocks.map((block) => block.kind)).toEqual(["entry", "basic", "exit"]);
    const body = cfg.blocks[1];
    expect(body?.statements).toEqual(["const a = 1;", "const b = a + 1;"]);
    expect(cfg.edges).toEqual([
      { from: "entry", to: "b1", kind: "normal" },
      { from: "b1", to: "exit", kind: "normal" },
    ]);
  });

  it("branches an if/else with true and false edges that rejoin", () => {
    const cfg = only(
      "function f(x: number) {\n  if (x > 0) {\n    hi();\n  } else {\n    lo();\n  }\n  done();\n}\ndeclare function hi(): void; declare function lo(): void; declare function done(): void;\n",
    );
    expect(edgeKinds(cfg)).toContain("true");
    expect(edgeKinds(cfg)).toContain("false");
    // Both arms rejoin on the block holding done().
    const join = cfg.blocks.find((block) => block.statements.includes("done();"));
    expect(join).toBeDefined();
    const into = cfg.edges.filter((edge) => edge.to === join?.id);
    expect(into.length).toBe(2);
  });

  it("wires a while loop with a distinct back edge", () => {
    const cfg = only("function f(n: number) {\n  while (n > 0) {\n    n -= 1;\n  }\n}\n");
    const back = cfg.edges.filter((edge) => edge.kind === "back");
    expect(back.length).toBe(1);
    const condition = cfg.blocks.find((block) => block.statements.includes("n > 0"));
    expect(back[0]?.to).toBe(condition?.id);
  });

  it("marks statements after a return as unreachable", () => {
    const cfg = only('function f() {\n  return 1;\n  console.log("never");\n}\n');
    const reachable = reachableCfgBlocks(cfg);
    const dead = cfg.blocks.find((block) => block.statements.some((s) => s.includes("never")));
    expect(dead).toBeDefined();
    expect(reachable.has(dead?.id ?? "")).toBe(false);
  });

  it("routes a labeled break past the inner loop", () => {
    const cfg = only(
      "function f() {\n  outer: for (let i = 0; i < 3; i++) {\n    for (let j = 0; j < 3; j++) {\n      if (j === i) {\n        break outer;\n      }\n    }\n  }\n  done();\n}\ndeclare function done(): void;\n",
    );
    const breakBlock = cfg.blocks.find((block) =>
      block.statements.some((s) => s.includes("break outer")),
    );
    const target = cfg.blocks.find((block) => block.statements.includes("done();"));
    expect(breakBlock).toBeDefined();
    expect(cfg.edges.some((edge) => edge.from === breakBlock?.id && edge.to === target?.id)).toBe(
      true,
    );
  });

  it("re-routes a return inside try through the finally", () => {
    const cfg = only(
      "function f() {\n  try {\n    return 1;\n  } finally {\n    cleanup();\n  }\n}\ndeclare function cleanup(): void;\n",
    );
    const ret = cfg.blocks.find((block) => block.statements.some((s) => s.includes("return 1")));
    const fin = cfg.blocks.find((block) => block.statements.includes("cleanup();"));
    expect(ret).toBeDefined();
    expect(fin).toBeDefined();
    // return → finally (kind finally), then finally forwards to exit.
    expect(
      cfg.edges.some(
        (edge) => edge.from === ret?.id && edge.to === fin?.id && edge.kind === "finally",
      ),
    ).toBe(true);
    expect(cfg.edges.some((edge) => edge.from === fin?.id && edge.to === "exit")).toBe(true);
  });

  it("labels switch dispatch edges with case values, fallthrough and no-match", () => {
    const cfg = only(
      'function f(k: string) {\n  switch (k) {\n    case "a":\n      one();\n    case "b":\n      two();\n      break;\n  }\n}\ndeclare function one(): void; declare function two(): void;\n',
    );
    const cases = cfg.edges.filter((edge) => edge.kind === "case");
    expect(cases.map((edge) => edge.label).sort()).toEqual(['"a"', '"b"', "no match"]);
    // Fallthrough: the "a" block flows into the "b" block.
    const aBlock = cfg.blocks.find((block) => block.statements.includes("one();"));
    const bBlock = cfg.blocks.find((block) => block.statements.includes("two();"));
    expect(
      cfg.edges.some(
        (edge) => edge.from === aBlock?.id && edge.to === bBlock?.id && edge.kind === "normal",
      ),
    ).toBe(true);
  });

  it("marks awaiting blocks and keeps async flow sequential", () => {
    const cfg = only(
      "async function f() {\n  const a = await fetchA();\n  use(a);\n}\ndeclare function fetchA(): Promise<number>; declare function use(a: number): void;\n",
    );
    const awaiting = cfg.blocks.filter((block) => block.awaits === true);
    expect(awaiting.length).toBe(1);
    expect(edgeKinds(cfg).every((kind) => kind === "normal")).toBe(true);
  });

  it("treats an arrow expression body as a single returning block", () => {
    const { cfgs } = extractControlFlow({
      path: "a.ts",
      text: "export const twice = (n: number) => n * 2;\n",
    });
    expect(cfgs.length).toBe(1);
    const cfg = cfgs[0] as ControlFlowGraph;
    expect(cfg.name).toBe("twice");
    expect(cfg.blocks.filter((block) => block.kind === "basic").length).toBe(1);
    expect(validateCfg(cfg)).toEqual([]);
  });

  it("extracts nested functions as separate CFGs without leaking statements", () => {
    const { cfgs } = extractControlFlow({
      path: "n.ts",
      text: "function outer() {\n  const x = 1;\n  function inner() {\n    return 2;\n  }\n  return x;\n}\n",
    });
    expect(cfgs.map((cfg) => cfg.name)).toEqual(["outer", "inner"]);
    const outer = cfgs[0] as ControlFlowGraph;
    // inner's `return 2` must not appear in outer's blocks.
    expect(
      outer.blocks.every((block) => !block.statements.some((s) => s.includes("return 2"))),
    ).toBe(true);
  });

  it("is deterministic across runs", () => {
    const source =
      "function f(n: number) {\n  for (let i = 0; i < n; i++) {\n    if (i % 2) {\n      continue;\n    }\n    try {\n      work(i);\n    } catch (error) {\n      report(error);\n    }\n  }\n}\ndeclare function work(i: number): void; declare function report(e: unknown): void;\n";
    const first = extractControlFlow({ path: "d.ts", text: source });
    const second = extractControlFlow({ path: "d.ts", text: source });
    expect(second).toEqual(first);
  });
});

describe("cfgAtLine", () => {
  it("returns the innermost enclosing function", () => {
    const { cfgs } = extractControlFlow({
      path: "pos.ts",
      text: "function outer() {\n  function inner() {\n    return 1;\n  }\n  return inner();\n}\n",
    });
    expect(cfgAtLine(cfgs, 3)?.name).toBe("inner");
    expect(cfgAtLine(cfgs, 5)?.name).toBe("outer");
    expect(cfgAtLine(cfgs, 99)).toBeUndefined();
  });
});
