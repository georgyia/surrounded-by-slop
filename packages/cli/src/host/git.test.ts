import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "../cli.js";
import { bufferContext } from "../context.js";
import { gitDiff, isGitRepository } from "./git.js";

/**
 * Everything here asserts on *our* messages, never on git's: git is localized,
 * and a test that greps for English output fails on a German machine — which
 * is exactly how this bug was found (#139).
 */

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sbs-git-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function initRepo(at: string): void {
  const git = (...args: string[]): void => {
    execFileSync("git", ["-C", at, ...args], { stdio: "ignore" });
  };
  git("init");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
}

describe("isGitRepository", () => {
  it("is false for a plain directory", () => {
    expect(isGitRepository(root)).toBe(false);
  });

  it("is true inside a repository", () => {
    initRepo(root);
    expect(isGitRepository(root)).toBe(true);
  });
});

describe("gitDiff outside a repository", () => {
  it("says the directory is not a repository, rather than passing git's error through", () => {
    // Outside a repo git falls back to --no-index and rejects `--staged` — an
    // error about a flag we passed, for a mode nobody asked for.
    expect(() => gitDiff(root, { staged: true })).toThrow(/not a git repository/);
    expect(() => gitDiff(root, { ref: "HEAD" })).toThrow(/not a git repository/);
  });

  it("never mentions --no-index, which is git's confusion and not the user's problem", () => {
    let message = "";
    try {
      gitDiff(root, { staged: true });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toContain("no-index");
    expect(message).toContain(root);
  });
});

describe("sbs impact outside a repository", () => {
  it("exits non-zero with our message", async () => {
    const ctx = bufferContext(root);
    const code = await run(["impact", "--root", root, "--staged"], ctx);
    expect(code).toBe(1);
    expect(ctx.err()).toContain("not a git repository");
    expect(ctx.out()).toBe("");
  });

  it("still accepts a piped diff, which needs no repository at all", async () => {
    writeFileSync(join(root, "a.ts"), "export function a(): void {}\n");
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1 +1 @@",
      "-old",
      "+export function a(): void {}",
      "",
    ].join("\n");
    const ctx = bufferContext(root, diff);
    const code = await run(["impact", "--root", root, "-"], ctx);
    expect(code).toBe(0);
    expect(ctx.out()).toContain("a(): void");
  });
});

describe("gitDiff failures inside a repository", () => {
  it("reports one attributed line, not a wall of git output", async () => {
    initRepo(root);
    writeFileSync(join(root, "a.ts"), "export function a(): void {}\n");
    execFileSync("git", ["-C", root, "add", "."], { stdio: "ignore" });
    execFileSync("git", ["-C", root, "commit", "-m", "first"], { stdio: "ignore" });

    let message = "";
    try {
      gitDiff(root, { ref: "definitely-not-a-ref" });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    // Our prefix, and a single line — git's own wording stays localized and is
    // not asserted on.
    expect(message.startsWith("git diff failed: ")).toBe(true);
    expect(message.split("\n")).toHaveLength(1);
  });
});
