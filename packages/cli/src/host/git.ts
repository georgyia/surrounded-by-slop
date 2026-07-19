import { execFileSync } from "node:child_process";

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

/** Run `git diff` for the requested source and return the raw unified diff. */
export function gitDiff(root: string, source: DiffSource): string {
  const args = ["-C", root, "diff", "--unified=0", "--no-color", "--no-ext-diff"];
  if (source.staged === true) {
    args.push("--staged");
  }
  if (source.ref !== undefined) {
    args.push(source.ref);
  }
  try {
    return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`git diff failed: ${message}`);
  }
}
