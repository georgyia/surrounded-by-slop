import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { type FileInput, matchesAnyGlob } from "@surrounded-by-slop/core";

/**
 * Filesystem discovery — the host concern the pure core deliberately refuses
 * (Rule 5). Walks a project, applies include/exclude globs, and drops the noise
 * an architecture view never wants (tests, fixtures, generated bundles), turning
 * a directory into the `FileInput[]` the core analyzes.
 *
 * Defaults mirror the extension's workspace map (`packages/extension/src/config.ts`
 * and `controller.ts`) so the CLI and the diagram agree on what a project *is*,
 * and additionally exclude fixture directories that the extension still misses
 * (see #73). SBS-118 will fold both onto one shared implementation.
 */

export const DEFAULT_INCLUDE = ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,py}"] as const;

export const DEFAULT_EXCLUDE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/out/**",
  "**/build/**",
  "**/coverage/**",
  "**/.git/**",
  "**/.vscode-test/**",
  "**/.next/**",
  "**/.nuxt/**",
  "**/.svelte-kit/**",
  "**/.turbo/**",
  "**/.cache/**",
  "**/vendor/**",
  "**/*.min.js",
  // Beyond the extension's list: fixtures and test corpora are inputs to the
  // tool's own tests, never part of a project's architecture (#73).
  "**/fixtures/**",
  "**/__tests__/**",
  "**/testdata/**",
] as const;

/** Matches `foo.test.ts`, `bar.spec.jsx`, and the Python `test_x.py` / `x_test.py` conventions. */
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/i;
const PYTHON_TEST_FILE = /(^|\/)(test_[^/]+|[^/]+_test)\.py$/i;

/** Whether a path is a test file (shared with `impact`, which flags affected tests). */
export function isTestFile(path: string): boolean {
  return TEST_FILE.test(path) || PYTHON_TEST_FILE.test(path);
}

/**
 * A single line thousands of characters wide is a bundled or minified artifact,
 * not something worth analyzing. Mirrors the extension's `looksMinified` guard.
 */
function looksMinified(text: string): boolean {
  if (text.length < 20_000) {
    return false;
  }
  const newlines = (text.match(/\n/g) ?? []).length + 1;
  return text.length / newlines > 400;
}

/**
 * Expand a brace set like `*.{ts,js}` into the plain globs core's matcher
 * understands (`*.ts`, `*.js`). Only single-level braces appear in our patterns;
 * nested braces are left untouched.
 */
function expandBraces(glob: string): string[] {
  const match = glob.match(/\{([^{}]*)\}/);
  if (match === null) {
    return [glob];
  }
  const [whole, body] = match;
  return (body ?? "").split(",").flatMap((option) => expandBraces(glob.replace(whole, option)));
}

function expandAll(globs: readonly string[]): string[] {
  return globs.flatMap(expandBraces);
}

export interface DiscoverOptions {
  /** Glob patterns to include (default: {@link DEFAULT_INCLUDE}). */
  include?: readonly string[];
  /** Glob patterns to exclude (default: {@link DEFAULT_EXCLUDE}). */
  exclude?: readonly string[];
  /** Include test files (default: false). */
  includeTests?: boolean;
}

/**
 * Discover analyzable source files under `root`, returned as `FileInput[]` with
 * root-relative, forward-slashed paths, sorted for determinism. Unreadable files
 * are skipped rather than fatal — one bad file never sinks the run.
 */
export function discoverFiles(root: string, options: DiscoverOptions = {}): FileInput[] {
  const include = expandAll(options.include ?? DEFAULT_INCLUDE);
  const exclude = expandAll(options.exclude ?? DEFAULT_EXCLUDE);
  const includeTests = options.includeTests ?? false;

  const files: FileInput[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      const rel = relative(root, full).split(sep).join("/");
      let stats: ReturnType<typeof statSync>;
      try {
        stats = statSync(full);
      } catch {
        continue;
      }
      if (stats.isDirectory()) {
        // Prune excluded directories up front so we never descend node_modules.
        if (matchesAnyGlob(`${rel}/`, exclude) || matchesAnyGlob(rel, exclude)) {
          continue;
        }
        walk(full);
        continue;
      }
      if (!matchesAnyGlob(rel, include)) {
        continue;
      }
      if (matchesAnyGlob(rel, exclude)) {
        continue;
      }
      if (!includeTests && isTestFile(rel)) {
        continue;
      }
      let text: string;
      try {
        text = readFileSync(full, "utf8");
      } catch {
        continue;
      }
      if (looksMinified(text)) {
        continue;
      }
      files.push({ path: rel, text });
    }
  };
  walk(root);
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
