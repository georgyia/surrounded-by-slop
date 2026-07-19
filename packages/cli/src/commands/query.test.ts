import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { run } from "../cli.js";
import { bufferContext } from "../context.js";

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "sbs-query-"));
  const write = (rel: string, text: string): void => {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, text);
  };
  write(
    "src/index.ts",
    ['import { place } from "./orders";', "export function main() {", "  place();", "}"].join("\n"),
  );
  write(
    "src/orders.ts",
    ['import { money } from "./money";', "export function place() {", "  money();", "}"].join("\n"),
  );
  write("src/money.ts", "export function money() { return 1; }");
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const q = (...args: string[]) => {
  const ctx = bufferContext(root);
  const code = run(["query", "--root", root, ...args], ctx);
  return { code, out: ctx.out(), err: ctx.err() };
};

describe("query callers / callees", () => {
  it("lists the callers of a function", () => {
    const { code, out } = q("callers", "money");
    expect(code).toBe(0);
    expect(out).toContain("# callers of money");
    expect(out).toContain("place");
  });

  it("lists the callees of a function", () => {
    const { code, out } = q("callees", "main");
    expect(code).toBe(0);
    expect(out).toContain("place");
    expect(out).toContain("money"); // transitive
  });

  it("bounds callees with --depth", () => {
    const shallow = q("callees", "main", "--depth", "1");
    expect(shallow.out).toContain("place");
    expect(shallow.out).not.toContain("money"); // two hops away
  });
});

describe("query importers", () => {
  it("lists the modules importing a file", () => {
    const { code, out } = q("importers", "src/money.ts");
    expect(code).toBe(0);
    expect(out).toContain("# importers of src/money.ts");
    expect(out).toContain("src/orders.ts");
  });
});

describe("query path", () => {
  it("prints the shortest chain between two symbols", () => {
    const { code, out } = q("path", "main", "money");
    expect(code).toBe(0);
    expect(out).toContain("main → place → money");
  });

  it("reports when there is no path", () => {
    const { code, out } = q("path", "money", "main");
    expect(code).toBe(0);
    expect(out).toContain("no path from money to main");
  });
});

describe("query defs", () => {
  it("finds declarations by substring", () => {
    const { code, out } = q("defs", "place");
    expect(code).toBe(0);
    expect(out).toContain('# definitions matching "place"');
    expect(out).toContain("fn place");
  });
});

describe("query slice", () => {
  it("returns the neighborhood of a symbol", () => {
    const { code, out } = q("slice", "place", "--depth", "1");
    expect(code).toBe(0);
    expect(out).toContain("# slice around place");
  });
});

describe("query --json", () => {
  it("emits canonical IR JSON for callers", () => {
    const { code, out } = q("callers", "money", "--json");
    expect(code).toBe(0);
    const parsed = JSON.parse(out);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.nodes.some((n: { name: string }) => n.name === "place")).toBe(true);
  });

  it("emits a JSON id array for path", () => {
    const { out } = q("path", "main", "money", "--json");
    const parsed = JSON.parse(out);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toContain("main");
  });
});

describe("query error handling", () => {
  it("exits 1 with suggestions on an unknown symbol", () => {
    const { code, err } = q("callers", "moneyy");
    expect(code).toBe(1);
    expect(err).toContain('no symbol matching "moneyy"');
    expect(err).toContain("money"); // nearest-match suggestion
  });

  it("exits 2 on an unknown subcommand", () => {
    const { code, err } = q("neighbours", "money");
    expect(code).toBe(2);
    expect(err).toContain("unknown query");
  });

  it("exits 2 when a required operand is missing", () => {
    const { code, err } = q("callers");
    expect(code).toBe(2);
    expect(err).toContain("missing <symbol>");
  });
});
