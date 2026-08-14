import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "../cli.js";
import { bufferContext } from "../context.js";
import { AGENTS_BLOCK, END_MARKER, START_MARKER } from "./init.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sbs-init-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const init = (...args: string[]): ReturnType<typeof bufferContext> & { code: number } => {
  const ctx = bufferContext(root);
  const code = run(["init", ...args], ctx);
  return Object.assign(ctx, { code });
};

const agents = (): string => readFileSync(join(root, "AGENTS.md"), "utf8");

describe("sbs init", () => {
  it("bootstraps a fresh repo with AGENTS.md and a CLAUDE.md that imports it", () => {
    const ctx = init();
    expect(ctx.code).toBe(0);
    expect(agents()).toBe(`${AGENTS_BLOCK}\n`);
    expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toBe("@AGENTS.md\n");
    expect(ctx.out()).toContain("created: AGENTS.md");
  });

  it("is idempotent — running twice yields zero diff", () => {
    init();
    const first = agents();
    const second = init();
    expect(agents()).toBe(first);
    expect(second.out()).toContain("unchanged: AGENTS.md");
  });

  it("keeps the block at or under 20 lines, and never inlines a map", () => {
    const lines = AGENTS_BLOCK.split("\n");
    expect(lines.length).toBeLessThanOrEqual(20);
    expect(lines[0]).toBe(START_MARKER);
    expect(lines.at(-1)).toBe(END_MARKER);
    // It teaches pull, not push: it names the commands, it does not paste
    // their output (a generated dump measurably costs more and helps less).
    expect(AGENTS_BLOCK).toContain("`sbs map`");
    expect(AGENTS_BLOCK).not.toMatch(/^\s*(module|function|class)\b/m);
  });

  it("leaves the user's content byte-identical above and below the markers", () => {
    const before = "# My repo\n\nHand-written notes that matter.\n\n";
    const after = "\n## Conventions\n\nDo not touch this either.\n";
    writeFileSync(
      join(root, "AGENTS.md"),
      `${before}${START_MARKER}\nstale content\n${END_MARKER}${after}`,
    );

    expect(init().code).toBe(0);
    const result = agents();
    expect(result.startsWith(before)).toBe(true);
    expect(result.endsWith(after)).toBe(true);
    expect(result).toBe(`${before}${AGENTS_BLOCK}${after}`);
    expect(result).not.toContain("stale content");
  });

  it("appends to an existing AGENTS.md that has no block yet", () => {
    writeFileSync(join(root, "AGENTS.md"), "# Rules\n\nBe nice.\n");
    init();
    expect(agents()).toBe(`# Rules\n\nBe nice.\n\n${AGENTS_BLOCK}\n`);
  });

  it("never edits an existing CLAUDE.md, but says what to add", () => {
    writeFileSync(join(root, "CLAUDE.md"), "# Existing instructions\n");
    const ctx = init();
    expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toBe("# Existing instructions\n");
    expect(ctx.out()).toContain("@AGENTS.md");
  });

  it("stays quiet when an existing CLAUDE.md already imports AGENTS.md", () => {
    writeFileSync(join(root, "CLAUDE.md"), "@AGENTS.md\n\n# More\n");
    expect(init().out()).not.toContain("add ");
  });

  describe("--check", () => {
    it("exits 1 when AGENTS.md is missing entirely", () => {
      const ctx = init("--check");
      expect(ctx.code).toBe(1);
      expect(ctx.err()).toContain("sbs init");
    });

    it("exits 1 when the block is stale", () => {
      init();
      writeFileSync(join(root, "AGENTS.md"), `${START_MARKER}\nold\n${END_MARKER}\n`);
      expect(init("--check").code).toBe(1);
    });

    it("exits 0 when the block is current, and writes nothing", () => {
      init();
      const before = agents();
      const ctx = init("--check");
      expect(ctx.code).toBe(0);
      expect(agents()).toBe(before);
    });

    it("does not create files as a side effect of checking", () => {
      init("--check");
      expect(existsSync(join(root, "AGENTS.md"))).toBe(false);
      expect(existsSync(join(root, "CLAUDE.md"))).toBe(false);
    });
  });

  it("targets an explicit path argument", () => {
    const nested = mkdtempSync(join(tmpdir(), "sbs-init-nested-"));
    try {
      expect(run(["init", nested], bufferContext(root))).toBe(0);
      expect(readFileSync(join(nested, "AGENTS.md"), "utf8")).toBe(`${AGENTS_BLOCK}\n`);
      expect(existsSync(join(root, "AGENTS.md"))).toBe(false);
    } finally {
      rmSync(nested, { recursive: true, force: true });
    }
  });

  it("is listed in the top-level help", () => {
    const ctx = bufferContext(root);
    run(["--help"], ctx);
    expect(ctx.out()).toContain("init [path]");
  });
});
