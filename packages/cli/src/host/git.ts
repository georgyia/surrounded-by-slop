import { spawnSync } from "node:child_process";

/**
 * The only place `impact` shells out (Rule 5 keeps core pure). Produces a unified
 * diff with zero context lines — `git diff --unified=0` — so the hunk headers map
 * straight onto changed line ranges without surrounding noise.
 */

export interface DiffSource {
  /** Diff the staged index against HEAD. */
  staged?: boolean;
  /** Diff the working tree against a ref (branch, tag, `HEAD~1`, `origin/main...`). */
  ref?: string;
}

/**
 * True when `root` is inside a git working tree.
 *
 * Checked before diffing because git's own failure is misleading here: outside
 * a repository it falls back to `--no-index` mode and complains that
 * `--staged` is an unknown option — an error about a flag *we* passed, for a
 * mode the user never asked for, printed in whatever language their git speaks
 * (#139).
 */
export function isGitRepository(root: string): boolean {
  const result = spawnSync("git", ["-C", root, "rev-parse", "--git-dir"], {
    encoding: "utf8",
    stdio: ["ignore", "ignore", "ignore"],
  });
  return result.status === 0;
}

/** Run `git diff` for the requested source and return the raw unified diff. */
export function gitDiff(root: string, source: DiffSource): string {
  if (!isGitRepository(root)) {
    throw new Error(`${root} is not a git repository; impact needs one to diff against`);
  }
  const args = ["-C", root, "diff", "--unified=0", "--no-color", "--no-ext-diff"];
  if (source.staged === true) {
    args.push("--staged");
  }
  if (source.ref !== undefined) {
    args.push(source.ref);
  }
  // stderr is captured rather than inherited, so a git failure surfaces as our
  // one-line message instead of leaking a usage dump mid-command.
  const result = spawnSync("git", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error !== undefined) {
    throw new Error(`could not run git: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = (result.stderr ?? "").trim().split("\n")[0] ?? `exit ${result.status}`;
    throw new Error(`git diff failed: ${detail}`);
  }
  return result.stdout;
}
