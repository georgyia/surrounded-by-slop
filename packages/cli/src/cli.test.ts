import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { run } from "./cli.js";
import { bufferContext } from "./context.js";

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "sbs-cli-"));
  const write = (rel: string, text: string): void => {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, text);
  };
  write(
    "src/app.ts",
    ['import { save } from "./db";', "export function main() {", "  save();", "}"].join("\n"),
  );
  write("src/db.ts", "export function save() {}");
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("run", () => {
  it("analyze prints byte-identical JSON across runs", () => {
    const first = bufferContext(root);
    const second = bufferContext(root);
    expect(run(["analyze", root], first)).toBe(0);
    expect(run(["analyze", root], second)).toBe(0);
    expect(first.out()).toBe(second.out());
    expect(first.out()).toContain('"kind": "module"');
    expect(first.out()).toContain("function:src/db.ts#save");
  });

  it("analyze defaults to the context cwd", () => {
    const ctx = bufferContext(root);
    expect(run(["analyze"], ctx)).toBe(0);
    expect(ctx.out()).toContain("function:src/app.ts#main");
  });

  it("export renders mermaid", () => {
    const ctx = bufferContext(root);
    expect(run(["export", "--format", "mermaid", root], ctx)).toBe(0);
    expect(ctx.out()).toContain("flowchart");
  });

  it("map prints a ranked, budgeted repo map", () => {
    const ctx = bufferContext(root);
    expect(run(["map", root], ctx)).toBe(0);
    expect(ctx.out()).toContain("# repo map");
    expect(ctx.out()).toContain("fn save");
    expect(ctx.out()).toContain("deeper: `sbs query");
  });

  it("map rejects a non-positive budget", () => {
    const ctx = bufferContext(root);
    expect(run(["map", root, "--budget", "0"], ctx)).toBe(2);
    expect(ctx.err()).toContain("--budget must be positive");
  });

  it("rejects an unknown command with exit 2", () => {
    const ctx = bufferContext(root);
    expect(run(["frobnicate"], ctx)).toBe(2);
    expect(ctx.err()).toContain('unknown command "frobnicate"');
  });

  it("rejects an unknown export format with exit 2", () => {
    const ctx = bufferContext(root);
    expect(run(["export", "--format", "svg", root], ctx)).toBe(2);
    expect(ctx.err()).toContain("unknown --format");
  });

  it("prints help with no arguments", () => {
    const ctx = bufferContext(root);
    expect(run([], ctx)).toBe(0);
    expect(ctx.out()).toContain("headless code analysis");
  });

  it("emits alias discovery notes only with --verbose", () => {
    const quiet = bufferContext(root);
    run(["analyze", root], quiet);
    expect(quiet.err()).toBe("");

    const loud = bufferContext(root);
    run(["analyze", root, "--verbose"], loud);
    expect(loud.err()).toContain("path aliases");
  });
});

describe("run — resilience", () => {
  it("yields a partial graph and exits 0 on a syntactically broken file", () => {
    const broken = mkdtempSync(join(tmpdir(), "sbs-broken-"));
    writeFileSync(join(broken, "ok.ts"), "export function fine() {}");
    writeFileSync(join(broken, "bad.ts"), "export function oops( {{{ ");
    try {
      const ctx = bufferContext(broken);
      expect(run(["analyze", broken], ctx)).toBe(0);
      // The healthy file still made it into the graph.
      expect(ctx.out()).toContain("function:ok.ts#fine");
    } finally {
      rmSync(broken, { recursive: true, force: true });
    }
  });
});
