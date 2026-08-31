import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "../cli.js";
import { bufferContext } from "../context.js";

/**
 * An empty answer must never be indistinguishable from a confident one (#138).
 * Every command that answers a question about a project refuses to answer when
 * it read nothing, and says which of the several possible reasons applies.
 */

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sbs-empty-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const EXIT_NOTHING_ANALYZABLE = 3;

async function attempt(...argv: string[]): Promise<{ code: number; err: string; out: string }> {
  const ctx = bufferContext(root);
  const code = await run(argv, ctx);
  return { code, err: ctx.err(), out: ctx.out() };
}

describe("a project with nothing to analyze", () => {
  it("fails every question-answering command, rather than answering blankly", async () => {
    for (const argv of [
      ["map", root],
      ["analyze", root],
      ["export", "--format", "mermaid", root],
      ["query", "defs", "anything", "--root", root],
    ]) {
      const { code, err, out } = await attempt(...argv);
      expect(code, `${argv[0]} exit code`).toBe(EXIT_NOTHING_ANALYZABLE);
      expect(err, `${argv[0]} explains itself`).toContain("no analyzable files");
      expect(out, `${argv[0]} prints no answer`).toBe("");
    }
  });

  it("names the extensions it looked for, so an unsupported language is obvious", async () => {
    writeFileSync(join(root, "main.php"), "<?php function go() {}\n");
    const { code, err } = await attempt("map", root);
    expect(code).toBe(EXIT_NOTHING_ANALYZABLE);
    for (const supported of [".ts", ".py", ".go", ".rs", ".rb", ".cs", ".java"]) {
      expect(err).toContain(supported);
    }
  });

  it("distinguishes a project that is entirely tests, and says how to include them", async () => {
    writeFileSync(join(root, "app.test.ts"), "export function t(): void {}\n");
    const { code, err } = await attempt("map", root);
    expect(code).toBe(EXIT_NOTHING_ANALYZABLE);
    expect(err).toContain("looks like a test");
    expect(err).toContain("--include-tests");
  });

  it("analyzes those same files once --include-tests is passed", async () => {
    writeFileSync(join(root, "app.test.ts"), "export function t(): void {}\n");
    const { code, out } = await attempt("map", root, "--include-tests");
    expect(code).toBe(0);
    expect(out).toContain("app.test.ts");
  });

  it("blames --include when the filter is what emptied the set", async () => {
    writeFileSync(join(root, "a.ts"), "export function a(): void {}\n");
    const { code, err } = await attempt("map", root, "--include", "**/*.kt");
    expect(code).toBe(EXIT_NOTHING_ANALYZABLE);
    expect(err).toContain("--include narrowed everything away");
  });

  it("still succeeds, quietly, when there is genuinely something to read", async () => {
    writeFileSync(join(root, "a.ts"), "export function a(): void {}\n");
    const { code, err } = await attempt("map", root);
    expect(code).toBe(0);
    expect(err).toBe("");
  });
});
