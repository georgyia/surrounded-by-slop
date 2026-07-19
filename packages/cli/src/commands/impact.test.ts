import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { run } from "../cli.js";
import { bufferContext } from "../context.js";

let root: string;

const write = (base: string, rel: string, text: string): void => {
  const full = join(base, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, text);
};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "sbs-impact-"));
  write(root, "src/orders.ts", ["export function place() {", "  return 1;", "}"].join("\n"));
  write(
    root,
    "src/app.ts",
    [
      'import { place } from "./orders";',
      "export function main() {",
      "  return place();",
      "}",
    ].join("\n"),
  );
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const diff = [
  "diff --git a/src/orders.ts b/src/orders.ts",
  "--- a/src/orders.ts",
  "+++ b/src/orders.ts",
  "@@ -2 +2 @@",
  "-  return 1;",
  "+  return 2;",
].join("\n");

describe("impact via stdin", () => {
  it("reports the changed symbol and its callers", () => {
    const ctx = bufferContext(root, diff);
    expect(run(["impact", "--root", root, "-"], ctx)).toBe(0);
    expect(ctx.out()).toContain("# impact of 1 changed symbols");
    expect(ctx.out()).toContain("fn place");
    expect(ctx.out()).toContain("main"); // caller
  });

  it("emits a valid IR subgraph with --json", () => {
    const ctx = bufferContext(root, diff);
    expect(run(["impact", "--root", root, "-", "--json"], ctx)).toBe(0);
    const parsed = JSON.parse(ctx.out());
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.nodes.some((n: { name: string }) => n.name === "place")).toBe(true);
  });

  it("exits 0 with an empty message when nothing analyzable changed", () => {
    const docDiff = [
      "diff --git a/README.md b/README.md",
      "--- a/README.md",
      "+++ b/README.md",
      "@@ -1 +1 @@",
      "-old",
      "+new",
    ].join("\n");
    const ctx = bufferContext(root, docDiff);
    expect(run(["impact", "--root", root, "-"], ctx)).toBe(0);
    expect(ctx.out()).toContain("no analyzable symbols changed");
  });

  it("errors cleanly when stdin is unavailable", () => {
    const ctx = bufferContext(root); // no stdin supplied
    expect(run(["impact", "--root", root, "-"], ctx)).toBe(2);
    expect(ctx.err()).toContain("no stdin available");
  });
});

describe("impact via real git", () => {
  let repo: string;
  const git = (...args: string[]): void => {
    execFileSync("git", ["-C", repo, ...args], { stdio: "ignore" });
  };

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "sbs-impact-git-"));
    write(repo, "src/lib.ts", "export function core() { return 1; }");
    write(
      repo,
      "src/use.ts",
      ['import { core } from "./lib";', "export function wrap() { return core(); }"].join("\n"),
    );
    git("init");
    git("config", "user.email", "t@t.test");
    git("config", "user.name", "t");
    git("add", ".");
    git("commit", "-m", "init");
    // Stage an edit to core().
    write(repo, "src/lib.ts", "export function core() { return 2; }");
    git("add", "src/lib.ts");
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("computes the blast radius of the staged diff", () => {
    const ctx = bufferContext(repo);
    expect(run(["impact", "--root", repo, "--staged"], ctx)).toBe(0);
    expect(ctx.out()).toContain("fn core");
    expect(ctx.out()).toContain("wrap"); // caller of core
  });
});
