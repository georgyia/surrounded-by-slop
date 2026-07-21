import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
