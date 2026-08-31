import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MAX_FILE_BYTES } from "./decisions.js";
import { discoverFiles } from "./discovery.js";

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "sbs-discovery-"));
  const write = (rel: string, text: string): void => {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, text);
  };
  write("src/app.ts", "export const app = 1;");
  write("src/util.py", "value = 1");
  write("src/app.test.ts", "export const t = 1;");
  write("src/deep/nested.tsx", "export const n = 1;");
  write("fixtures/case/input.ts", "export const f = 1;");
  write("testdata/input.ts", "export const data = 1;");
  write("__tests__/thing.ts", "export const x = 1;");
  write("tests/helper.ts", "export const helper = 1;");
  write("spec/behavior.ts", "export const behavior = 1;");
  write("node_modules/pkg/index.ts", "export const dep = 1;");
  write("README.md", "# not source");
  write("bundle.min.js", `const a=1;${"//pad".repeat(6_000)}`);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("discoverFiles", () => {
  it("keeps source and drops tests, fixtures, dependencies, docs, and bundles", () => {
    const paths = discoverFiles(root).map((file) => file.path);
    expect(paths).toContain("src/app.ts");
    expect(paths).toContain("src/util.py");
    expect(paths).toContain("src/deep/nested.tsx");
    expect(paths).not.toContain("src/app.test.ts");
    expect(paths).not.toContain("fixtures/case/input.ts");
    expect(paths).not.toContain("testdata/input.ts");
    expect(paths).not.toContain("__tests__/thing.ts");
    expect(paths).not.toContain("tests/helper.ts");
    expect(paths).not.toContain("spec/behavior.ts");
    expect(paths).not.toContain("node_modules/pkg/index.ts");
    expect(paths).not.toContain("README.md");
    expect(paths).not.toContain("bundle.min.js");
  });

  it("returns deterministic forward-slashed paths", () => {
    const paths = discoverFiles(root).map((file) => file.path);
    expect(paths).toEqual([...paths].sort());
    expect(paths.every((path) => !path.includes("\\"))).toBe(true);
  });

  it("includes test files and test directories when asked, but not fixtures", () => {
    const paths = discoverFiles(root, { includeTests: true }).map((file) => file.path);
    expect(paths).toContain("src/app.test.ts");
    expect(paths).toContain("__tests__/thing.ts");
    expect(paths).toContain("tests/helper.ts");
    expect(paths).toContain("spec/behavior.ts");
    expect(paths).not.toContain("fixtures/case/input.ts");
    expect(paths).not.toContain("testdata/input.ts");
  });

  it("honors custom include globs", () => {
    const paths = discoverFiles(root, { include: ["**/*.{ts,tsx}"] }).map((file) => file.path);
    expect(paths).toContain("src/app.ts");
    expect(paths).not.toContain("src/util.py");
  });

  it("honors custom exclude globs", () => {
    const paths = discoverFiles(root, { exclude: ["src/deep/**"] }).map((file) => file.path);
    expect(paths).toContain("src/app.ts");
    expect(paths).not.toContain("src/deep/nested.tsx");
  });
});

describe("discovery guardrails (#144)", () => {
  let guardRoot: string;
  const write = (rel: string, text: string): void => {
    const full = join(guardRoot, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, text);
  };

  beforeEach(() => {
    guardRoot = mkdtempSync(join(tmpdir(), "sbs-guards-"));
  });

  afterEach(() => {
    rmSync(guardRoot, { recursive: true, force: true });
  });

  it("skips an oversized file without reading it, and says so", () => {
    const big = "x".repeat(MAX_FILE_BYTES + 1);
    write("src/generated.ts", `export const blob = "${big}";\n`);
    write("src/app.ts", "export function real(): void {}\n");

    const skips: Array<[string, string]> = [];
    const files = discoverFiles(guardRoot, {
      onSkip: (path, reason) => skips.push([path, reason]),
    });
    expect(files.map((file) => file.path)).toEqual(["src/app.ts"]);
    expect(skips).toEqual([["src/generated.ts", "too-large"]]);
  });

  it("keeps a large-but-plausible file when the caller raises the limit", () => {
    // Many short lines: genuinely large, but not the one-enormous-line shape
    // that marks a bundle. A generated-but-readable file looks like this.
    const lines: string[] = [];
    for (let index = 0; lines.join("\n").length <= MAX_FILE_BYTES; index += 1) {
      lines.push(`export function generated${index}(): number { return ${index}; }`);
    }
    write("src/big.ts", `${lines.join("\n")}\n`);

    expect(discoverFiles(guardRoot)).toEqual([]);
    const raised = discoverFiles(guardRoot, { maxFileBytes: MAX_FILE_BYTES * 4 });
    expect(raised.map((file) => file.path)).toEqual(["src/big.ts"]);
  });

  it("stops at the file limit and reports it exactly once", () => {
    for (let index = 0; index < 12; index += 1) {
      write(`src/f${String(index).padStart(2, "0")}.ts`, `export function f${index}(): void {}\n`);
    }
    const skips: string[] = [];
    const files = discoverFiles(guardRoot, {
      maxFiles: 5,
      onSkip: (path, reason) => {
        if (reason === "file-limit") {
          skips.push(path);
        }
      },
    });
    expect(files).toHaveLength(5);
    // One message, not one per remaining file — a 100k-file monorepo would
    // otherwise drown the user in warnings.
    expect(skips).toHaveLength(1);
  });

  it("reports a minified file rather than dropping it silently", () => {
    // looksMinified needs real bundle shape: >20 KB and >400 chars per line.
    write("src/bundle.js", `${"var a=1;".repeat(4000)}\n`);
    const skips: Array<[string, string]> = [];
    discoverFiles(guardRoot, { onSkip: (path, reason) => skips.push([path, reason]) });
    expect(skips).toEqual([["src/bundle.js", "minified"]]);
  });

  it("says nothing when nothing was skipped", () => {
    write("src/app.ts", "export function real(): void {}\n");
    const skips: string[] = [];
    const files = discoverFiles(guardRoot, { onSkip: (path) => skips.push(path) });
    expect(files).toHaveLength(1);
    expect(skips).toEqual([]);
  });
});
