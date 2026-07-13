import { describe, expect, it } from "vitest";
import { dataflowForSpan, extractDataflow, type FunctionDataflow } from "./dataflow.js";

function flowsOf(source: string): FunctionDataflow[] {
  const { functions, diagnostics } = extractDataflow({ path: "df.ts", text: source });
  expect(diagnostics).toEqual([]);
  return functions;
}

function variable(flow: FunctionDataflow, name: string, at = 0) {
  const matches = flow.variables.filter((candidate) => candidate.name === name);
  const found = matches[at];
  expect(found, `variable ${name}#${at} in ${flow.name}`).toBeDefined();
  return found as NonNullable<typeof found>;
}

describe("extractDataflow", () => {
  it("records writes and reads for straight-line assignments", () => {
    const [flow] = flowsOf(
      "function f(n: number): number {\n  let total = 0;\n  total += n;\n  return total;\n}\n",
    );
    expect(flow).toBeDefined();
    const total = variable(flow as FunctionDataflow, "total");
    // declaration write + compound write
    expect(total.writes.map((span) => span.startLine)).toEqual([2, 3]);
    // compound read + return read
    expect(total.reads.map((span) => span.startLine)).toEqual([3, 4]);
    const n = variable(flow as FunctionDataflow, "n");
    expect(n.writes.map((span) => span.startLine)).toEqual([1]); // parameter binding
    expect(n.reads.map((span) => span.startLine)).toEqual([3]);
  });

  it("splits shadowed names into separate variables per scope", () => {
    const [flow] = flowsOf(
      "function f(): number {\n  const x = 1;\n  {\n    const x = 2;\n    use(x);\n  }\n  return x;\n}\ndeclare function use(v: number): void;\n",
    );
    const outer = variable(flow as FunctionDataflow, "x", 0);
    const inner = variable(flow as FunctionDataflow, "x", 1);
    expect(outer.declarationSpan.startLine).toBe(2);
    expect(inner.declarationSpan.startLine).toBe(4);
    expect(inner.reads.map((span) => span.startLine)).toEqual([5]); // use(x) hits the inner x
    expect(outer.reads.map((span) => span.startLine)).toEqual([7]); // return x hits the outer x
  });

  it("declares every name bound by destructuring, and counts them as writes", () => {
    const [flow] = flowsOf(
      "function f(pair: { a: number; rest: number[] }): number {\n  const { a, rest: [first] } = pair;\n  return a + first;\n}\n",
    );
    const a = variable(flow as FunctionDataflow, "a");
    const first = variable(flow as FunctionDataflow, "first");
    expect(a.writes.map((span) => span.startLine)).toEqual([2]);
    expect(first.writes.map((span) => span.startLine)).toEqual([2]);
    expect(a.reads.map((span) => span.startLine)).toEqual([3]);
    // The destructuring key `rest:` is not a variable — only its binding is.
    expect((flow as FunctionDataflow).variables.some((v) => v.name === "rest")).toBe(false);
  });

  it("flags closed-over variables as captured on the inner function", () => {
    const flows = flowsOf(
      "function outer(): () => number {\n  let count = 0;\n  return () => {\n    count += 1;\n    return count;\n  };\n}\n",
    );
    expect(flows.map((flow) => flow.name)).toEqual(["outer", "<anonymous>"]);
    const inner = flows[1] as FunctionDataflow;
    const captured = variable(inner, "count");
    expect(captured.captured).toBe(true);
    expect(captured.writes.map((span) => span.startLine)).toEqual([4]);
    expect(captured.reads.map((span) => span.startLine)).toEqual([4, 5]);
    // The declaring function keeps only its own accesses (the initialization).
    const outerCount = variable(flows[0] as FunctionDataflow, "count");
    expect(outerCount.captured).toBeUndefined();
    expect(outerCount.writes.map((span) => span.startLine)).toEqual([2]);
    expect(outerCount.reads).toEqual([]);
  });

  it("treats destructuring assignment targets and ++ as writes", () => {
    const [flow] = flowsOf(
      "function f(): void {\n  let a = 0;\n  let b = 0;\n  [a, b] = [b, a];\n  a++;\n}\n",
    );
    const a = variable(flow as FunctionDataflow, "a");
    expect(a.writes.map((span) => span.startLine)).toEqual([2, 4, 5]);
    expect(a.reads.map((span) => span.startLine)).toEqual([4, 5]); // rhs of swap + a++
  });

  it("scopes loop-head bindings per loop and marks for-of writes", () => {
    const [flow] = flowsOf(
      "function f(items: number[]): number {\n  let sum = 0;\n  for (const item of items) {\n    sum += item;\n  }\n  return sum;\n}\n",
    );
    const item = variable(flow as FunctionDataflow, "item");
    expect(item.writes.map((span) => span.startLine)).toEqual([3]); // bound each iteration
    expect(item.reads.map((span) => span.startLine)).toEqual([4]);
  });

  it("ignores property names, labels and type positions", () => {
    const [flow] = flowsOf(
      "function f(box: { size: number }): number {\n  const size: number = box.size;\n  outer: for (;;) {\n    break outer;\n  }\n  return size;\n}\n",
    );
    const names = (flow as FunctionDataflow).variables.map((v) => v.name);
    expect(names).toEqual(["box", "size"]);
    const size = variable(flow as FunctionDataflow, "size");
    expect(size.reads.map((span) => span.startLine)).toEqual([6]);
  });

  it("keeps module-level bindings out of function dataflow (documented limit)", () => {
    const flows = flowsOf(
      "const BASE = 10;\nfunction f(n: number): number {\n  return BASE + n;\n}\n",
    );
    const names = (flows[0] as FunctionDataflow).variables.map((v) => v.name);
    expect(names).toEqual(["n"]);
  });

  it("is deterministic and aligns with a function span via dataflowForSpan", () => {
    const source =
      "function a(): void {\n  const x = 1;\n  void x;\n}\nfunction b(): void {\n  const y = 2;\n  void y;\n}\n";
    const first = extractDataflow({ path: "d.ts", text: source });
    const second = extractDataflow({ path: "d.ts", text: source });
    expect(second).toEqual(first);
    const [flowA] = first.functions;
    expect(flowA).toBeDefined();
    if (flowA) {
      expect(dataflowForSpan(first.functions, flowA.span)?.name).toBe("a");
    }
  });
});
