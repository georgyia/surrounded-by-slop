import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { type FileInput, matchesAnyGlob } from "@surrounded-by-slop/core";
import {
  DEFAULT_EXCLUDE,
  DEFAULT_INCLUDE,
  expandBraces,
  isTestFile,
  looksMinified,
} from "./decisions.js";

export interface DiscoverOptions {
  /** Glob patterns to include (default: {@link DEFAULT_INCLUDE}). */
  include?: readonly string[];
  /** Glob patterns to exclude (default: {@link DEFAULT_EXCLUDE}). */
  exclude?: readonly string[];
  /** Include test files and test directories (default: false). */
  includeTests?: boolean;
}

/**
 * Discover analyzable source files under `root`, returned with root-relative,
 * forward-slashed paths in deterministic order. Unreadable entries are skipped.
 */
export function discoverFiles(root: string, options: DiscoverOptions = {}): FileInput[] {
  const include = (options.include ?? DEFAULT_INCLUDE).flatMap(expandBraces);
  const exclude = (options.exclude ?? DEFAULT_EXCLUDE).flatMap(expandBraces);
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
        if (matchesAnyGlob(`${rel}/`, exclude) || matchesAnyGlob(rel, exclude)) {
          continue;
        }
        walk(full);
        continue;
      }
      if (
        !matchesAnyGlob(rel, include) ||
        matchesAnyGlob(rel, exclude) ||
        (!includeTests && isTestFile(rel))
      ) {
        continue;
      }
      let text: string;
      try {
        text = readFileSync(full, "utf8");
      } catch {
        continue;
      }
      if (!looksMinified(text)) {
        files.push({ path: rel, text });
      }
    }
  };

  walk(root);
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
