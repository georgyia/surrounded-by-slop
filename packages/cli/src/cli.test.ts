import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { builtinExporters } from "@surrounded-by-slop/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { run } from "./cli.js";
import { CLI_EXPORTERS } from "./commands/export.js";
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
  it("analyze prints byte-identical JSON across runs", async () => {
    const first = bufferContext(root);
    const second = bufferContext(root);
    expect(await run(["analyze", root], first)).toBe(0);
    expect(await run(["analyze", root], second)).toBe(0);
    expect(first.out()).toBe(second.out());
    expect(first.out()).toContain('"kind": "module"');
    expect(first.out()).toContain("function:src/db.ts#save");
  });

  it("analyze defaults to the context cwd", async () => {
    const ctx = bufferContext(root);
    expect(await run(["analyze"], ctx)).toBe(0);
    expect(ctx.out()).toContain("function:src/app.ts#main");
  });

  it("export renders mermaid", async () => {
    const ctx = bufferContext(root);
    expect(await run(["export", "--format", "mermaid", root], ctx)).toBe(0);
    expect(ctx.out()).toContain("flowchart");
  });

  it("map prints a ranked, budgeted repo map", async () => {
    const ctx = bufferContext(root);
    expect(await run(["map", root], ctx)).toBe(0);
    expect(ctx.out()).toContain("# repo map");
    expect(ctx.out()).toContain("fn save");
    expect(ctx.out()).toContain("deeper: `sbs query");
  });

  it("map rejects a non-positive budget", async () => {
    const ctx = bufferContext(root);
    expect(await run(["map", root, "--budget", "0"], ctx)).toBe(2);
    expect(ctx.err()).toContain("--budget must be positive");
  });

  it("rejects an unknown command with exit 2", async () => {
    const ctx = bufferContext(root);
    expect(await run(["frobnicate"], ctx)).toBe(2);
    expect(ctx.err()).toContain('unknown command "frobnicate"');
  });

  it("rejects an unknown export format with exit 2", async () => {
    const ctx = bufferContext(root);
    expect(await run(["export", "--format", "svg", root], ctx)).toBe(2);
    expect(ctx.err()).toContain("unknown --format");
  });

  it("prints help with no arguments", async () => {
    const ctx = bufferContext(root);
    expect(await run([], ctx)).toBe(0);
    expect(ctx.out()).toContain("headless code analysis");
  });

  it("emits alias discovery notes only with --verbose", async () => {
    const quiet = bufferContext(root);
    await run(["analyze", root], quiet);
    expect(quiet.err()).toBe("");

    const loud = bufferContext(root);
    await run(["analyze", root, "--verbose"], loud);
    expect(loud.err()).toContain("path aliases");
  });
});

describe("run — resilience", () => {
  it("yields a partial graph and exits 0 on a syntactically broken file", async () => {
    const broken = mkdtempSync(join(tmpdir(), "sbs-broken-"));
    writeFileSync(join(broken, "ok.ts"), "export function fine() {}");
    writeFileSync(join(broken, "bad.ts"), "export function oops( {{{ ");
    try {
      const ctx = bufferContext(broken);
      expect(await run(["analyze", broken], ctx)).toBe(0);
      // The healthy file still made it into the graph.
      expect(ctx.out()).toContain("function:ok.ts#fine");
    } finally {
      rmSync(broken, { recursive: true, force: true });
    }
  });
});

describe("sbs export — the format set is derived, not restated (#132)", () => {
  it("offers exactly the layout-free built-in exporters", () => {
    // The rule is "a headless pipe cannot produce a positioned diagram". Deriving
    // the set from `needsLayout` means a future exporter obeys it automatically.
    expect(CLI_EXPORTERS.map((exporter) => exporter.id).sort()).toEqual(
      builtinExporters
        .filter((exporter) => !exporter.needsLayout)
        .map((exporter) => exporter.id)
        .sort(),
    );
    expect(CLI_EXPORTERS.some((exporter) => exporter.needsLayout)).toBe(false);
  });

  it("renders every format it advertises", async () => {
    const root = mkdtempSync(join(tmpdir(), "sbs-formats-"));
    try {
      writeFileSync(join(root, "a.ts"), "export function go(): void {}\n");
      for (const exporter of CLI_EXPORTERS) {
        const ctx = bufferContext(root);
        expect(await run(["export", "--format", exporter.id, root], ctx)).toBe(0);
        expect(ctx.out().length).toBeGreaterThan(0);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a layout format and names the ones that work", async () => {
    const ctx = bufferContext(process.cwd());
    expect(await run(["export", "--format", "svg", process.cwd()], ctx)).toBe(2);
    for (const exporter of CLI_EXPORTERS) {
      expect(ctx.err()).toContain(exporter.id);
    }
  });
});
