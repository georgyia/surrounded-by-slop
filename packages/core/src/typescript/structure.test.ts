import { describe, expect, it } from "vitest";
import { validateGraph } from "../ir/validate.js";
import { analyzeTypeScriptProject } from "./adapter.js";

/** Inline edge cases that would make single-purpose fixtures noisy. */
function analyze(text: string, path = "input.ts") {
  const result = analyzeTypeScriptProject([{ path, text }]);
  expect(validateGraph(result.graph)).toEqual([]);
  return result;
}

function nodeIds(text: string, path = "input.ts"): string[] {
  return analyze(text, path).graph.nodes.map((node) => node.id);
}

describe("member name forms", () => {
  it("captures string, numeric, computed and private member names", () => {
    const ids = nodeIds(
      [
        "const key = 'dynamic';",
        "export class Box {",
        "  'with space'(): void {}",
        "  42(): void {}",
        "  [key](): void {}",
        "  #secret(): void {}",
        "}",
      ].join("\n"),
    );
    expect(ids).toContain("method:input.ts#Box.with space");
    expect(ids).toContain("method:input.ts#Box.42");
    expect(ids).toContain("method:input.ts#Box.[key]");
    expect(ids).toContain("method:input.ts#Box.#secret");
  });

  it("merges method overloads into one node", () => {
    const ids = nodeIds(
      [
        "export class Api {",
        "  get(key: string): string;",
        "  get(key: number): number;",
        "  get(key: unknown): unknown { return key; }",
        "}",
      ].join("\n"),
    );
    expect(ids.filter((id) => id.startsWith("method:input.ts#Api.get"))).toEqual([
      "method:input.ts#Api.get",
    ]);
  });
});

describe("default export forms", () => {
  it("captures export default class expressions", () => {
    const result = analyze("export default class Runner { run(): void {} }");
    const runner = result.graph.nodes.find((node) => node.id === "class:input.ts#Runner");
    expect(runner?.exported).toBe(true);
    expect(result.graph.nodes.map((n) => n.id)).toContain("method:input.ts#Runner.run");
  });

  it("captures anonymous default class expressions under the name default", () => {
    expect(nodeIds("const x = 1;\nexport default class { }")).toContain("class:input.ts#default");
  });

  it("captures named function expressions in export default", () => {
    const result = analyze("export default function named(): number { return 1; }");
    const named = result.graph.nodes.find((node) => node.id === "function:input.ts#named");
    expect(named?.exported).toBe(true);
  });

  it("creates no node for other default-export expressions", () => {
    const ids = nodeIds("export default { answer: 42 };");
    expect(ids).toEqual(["module:input.ts"]);
  });
});

describe("namespace forms", () => {
  it("captures dotted namespace declarations", () => {
    const ids = nodeIds("namespace A.B { export const x = 1; }");
    expect(ids).toContain("namespace:input.ts#A");
    expect(ids).toContain("namespace:input.ts#A.B");
    expect(ids).toContain("variable:input.ts#A.B.x");
  });

  it("skips string-named ambient modules", () => {
    expect(nodeIds('declare module "some-lib" { const x: number; }')).toEqual(["module:input.ts"]);
  });
});

describe("javascript inputs", () => {
  it("analyzes .js files", () => {
    expect(nodeIds("export function plain() { return 1; }", "input.js")).toContain(
      "function:input.js#plain",
    );
  });

  it("analyzes .jsx files", () => {
    expect(nodeIds("export const App = () => <div/>;", "input.jsx")).toContain(
      "function:input.jsx#App",
    );
  });

  it("ignores non-analyzable files", () => {
    const result = analyzeTypeScriptProject([
      { path: "styles.css", text: "body {}" },
      { path: "input.ts", text: "export const x = 1;" },
    ]);
    expect(result.graph.nodes.map((n) => n.id)).toEqual(["module:input.ts", "variable:input.ts#x"]);
  });
});

describe("doc comments", () => {
  it("takes the first line and skips empty comments", () => {
    const result = analyze(
      ["/**", " * First line.", " * Second line.", " */", "export function f(): void {}"].join(
        "\n",
      ),
    );
    const f = result.graph.nodes.find((node) => node.id === "function:input.ts#f");
    expect(f?.doc).toBe("First line.");
  });
});

describe("variables", () => {
  it("skips destructuring and captures multi-declarator statements", () => {
    const ids = nodeIds("export const { a } = { a: 1 };\nexport const b = 2, c = 3;");
    expect(ids).not.toContain("variable:input.ts#a");
    expect(ids).toContain("variable:input.ts#b");
    expect(ids).toContain("variable:input.ts#c");
  });
});

describe("signatures render what the author wrote (#149)", () => {
  const signatures = (text: string): Map<string, string | undefined> => {
    const { graph } = analyzeTypeScriptProject([{ path: "a.ts", text }]);
    return new Map(graph.nodes.map((node) => [node.name, node.signature]));
  };

  it("keeps array types, which the checker cannot resolve without lib", () => {
    // `noLib` is deliberate, but it left `string[]` printing as `{}` — which
    // reads as "returns an empty object", not as "unknown".
    const found = signatures(
      [
        "export function ret(): string[] { return []; }",
        "export function take(items: string[]): number { return items.length; }",
      ].join("\n"),
    );
    expect(found.get("ret")).toBe("(): string[]");
    expect(found.get("take")).toBe("(items: string[]): number");
  });

  it("keeps generics, bounds, rest, optional and destructured parameters", () => {
    const found = signatures(
      [
        "export function generic<T>(items: T[]): T | undefined { return items[0]; }",
        "export function bounded<T extends { id: string }>(x: T): T[] { return [x]; }",
        "export function rest(first: string, ...others: number[]): void {}",
        "export function optional(a: string, b?: string[]): void {}",
        "export function destructured({ a }: { a: string[] }): void {}",
      ].join("\n"),
    );
    expect(found.get("generic")).toBe("<T>(items: T[]): T | undefined");
    expect(found.get("bounded")).toBe("<T extends { id: string }>(x: T): T[]");
    expect(found.get("rest")).toBe("(first: string, ...others: number[]): void");
    expect(found.get("optional")).toBe("(a: string, b?: string[]): void");
    expect(found.get("destructured")).toBe("({ a }: { a: string[] }): void");
  });

  it("keeps readonly and nested array forms", () => {
    const found = signatures(
      [
        "export function ro(xs: readonly string[]): ReadonlyArray<number> { return []; }",
        "export function nested(): Array<Map<string, string[]>> { return []; }",
      ].join("\n"),
    );
    expect(found.get("ro")).toBe("(xs: readonly string[]): ReadonlyArray<number>");
    expect(found.get("nested")).toBe("(): Array<Map<string, string[]>>");
  });

  it("keeps a genuine {} the author wrote", () => {
    expect(signatures("export function empty(): {} { return {}; }").get("empty")).toBe("(): {}");
  });

  it("omits a return type it cannot resolve rather than claiming {}", () => {
    // Unannotated and returning an array: the checker infers an unresolved
    // type. Saying nothing is honest; saying `{}` is a specific wrong claim.
    expect(signatures("export function guess() { return [1, 2, 3]; }").get("guess")).toBe("()");
  });

  it("still uses the checker where inference is trustworthy", () => {
    const found = signatures("export function add(a: number, b: number) { return a + b; }");
    expect(found.get("add")).toBe("(a: number, b: number): number");
  });
});

describe("signatures from a file that does not parse (#149)", () => {
  it("falls back to the checker rather than printing a truncated annotation", () => {
    // `function broken(a: {` leaves the annotation's source text as a bare
    // `{`. Printing that would turn a partial graph into a malformed one.
    const { graph } = analyzeTypeScriptProject([
      { path: "a.ts", text: "export function broken(a: {\n  return a;\n}\n" },
    ]);
    const broken = graph.nodes.find((node) => node.name === "broken");
    expect(broken?.signature).toBeDefined();
    const signature = broken?.signature ?? "";
    // Whatever it says, it is well-formed: balanced, and no stray fragment.
    const opens = (signature.match(/[{[(]/g) ?? []).length;
    const closes = (signature.match(/[}\])]/g) ?? []).length;
    expect(opens).toBe(closes);
    expect(signature).not.toBe("(a: {): any");
  });
});
