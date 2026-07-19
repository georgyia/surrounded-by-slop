import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { discoverFiles } from "./discovery.js";

/** A temp project exercising every discovery rule. */
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
  write("src/app.test.ts", "export const t = 1;"); // test file
  write("src/deep/nested.tsx", "export const n = 1;");
  write("fixtures/case/input.ts", "export const f = 1;"); // fixture dir
  write("__tests__/thing.ts", "export const x = 1;"); // test dir
  write("node_modules/pkg/index.ts", "export const dep = 1;"); // dependency
  write("README.md", "# not source");
  write("bundle.min.js", `const a=1;${"//pad".repeat(6000)}`); // minified
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("discoverFiles", () => {
  it("keeps real source, drops tests, fixtures, deps, docs and bundles", () => {
    const paths = discoverFiles(root).map((file) => file.path);
    expect(paths).toContain("src/app.ts");
    expect(paths).toContain("src/util.py");
    expect(paths).toContain("src/deep/nested.tsx");
    expect(paths).not.toContain("src/app.test.ts");
    expect(paths).not.toContain("fixtures/case/input.ts");
    expect(paths).not.toContain("__tests__/thing.ts");
    expect(paths).not.toContain("node_modules/pkg/index.ts");
    expect(paths).not.toContain("README.md");
    expect(paths).not.toContain("bundle.min.js");
  });

  it("returns forward-slashed paths sorted deterministically", () => {
    const paths = discoverFiles(root).map((file) => file.path);
    expect(paths).toEqual([...paths].sort());
    expect(paths.every((p) => !p.includes("\\"))).toBe(true);
  });

  it("includes test files when asked", () => {
    const paths = discoverFiles(root, { includeTests: true }).map((file) => file.path);
    expect(paths).toContain("src/app.test.ts");
  });

  it("honors custom include globs (brace sets expanded)", () => {
    const paths = discoverFiles(root, { include: ["**/*.{ts,tsx}"] }).map((file) => file.path);
    expect(paths).toContain("src/app.ts");
    expect(paths).not.toContain("src/util.py"); // .py excluded by the narrower include
  });

  it("honors custom exclude globs", () => {
    const paths = discoverFiles(root, { exclude: ["src/deep/**"] }).map((file) => file.path);
    expect(paths).toContain("src/app.ts");
    expect(paths).not.toContain("src/deep/nested.tsx");
  });
});
