import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { type FileInput, matchesAnyGlob } from "@surrounded-by-slop/core";
import {
  DEFAULT_EXCLUDE,
  DEFAULT_INCLUDE,
  expandBraces,
  isTestFile,
  looksMinified,
  MAX_FILE_BYTES,
  MAX_PROJECT_FILES,
} from "./decisions.js";

/** Why a file the globs matched was passed over anyway. */
export type SkipReason = "too-large" | "minified" | "file-limit";

export interface DiscoverOptions {
  /** Glob patterns to include (default: {@link DEFAULT_INCLUDE}). */
  include?: readonly string[];
  /** Glob patterns to exclude (default: {@link DEFAULT_EXCLUDE}). */
  exclude?: readonly string[];
  /** Include test files and test directories (default: false). */
  includeTests?: boolean;
  /** Skip files larger than this (default: {@link MAX_FILE_BYTES}). */
  maxFileBytes?: number;
  /** Stop after this many files (default: {@link MAX_PROJECT_FILES}). */
  maxFiles?: number;
  /**
   * Called for every file the globs matched but the walk passed over.
   * Dropping files silently is precisely what this project criticizes in other
   * tools, so a host can always say what it skipped and why.
   */
  onSkip?: (path: string, reason: SkipReason) => void;
}

/**
 * Discover analyzable source files under `root`, returned with root-relative,
 * forward-slashed paths in deterministic order. Unreadable entries are skipped.
 */
export function discoverFiles(root: string, options: DiscoverOptions = {}): FileInput[] {
  const include = (options.include ?? DEFAULT_INCLUDE).flatMap(expandBraces);
  const exclude = (options.exclude ?? DEFAULT_EXCLUDE).flatMap(expandBraces);
  const includeTests = options.includeTests ?? false;
  const maxFileBytes = options.maxFileBytes ?? MAX_FILE_BYTES;
  const maxFiles = options.maxFiles ?? MAX_PROJECT_FILES;
  const onSkip = options.onSkip;
  const files: FileInput[] = [];
  let stopped = false;

  const walk = (dir: string): void => {
    if (stopped) {
      return;
    }
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
      if (files.length >= maxFiles) {
        // Report once, on the first file over the line: a per-file message for
        // every remaining file in a 100k-file monorepo helps nobody.
        if (!stopped) {
          stopped = true;
          onSkip?.(rel, "file-limit");
        }
        return;
      }
      // The stat above already told us the size, so an oversized file is
      // skipped without ever being read into memory.
      if (stats.size > maxFileBytes) {
        onSkip?.(rel, "too-large");
        continue;
      }
      let text: string;
      try {
        text = readFileSync(full, "utf8");
      } catch {
        continue;
      }
      if (looksMinified(text)) {
        onSkip?.(rel, "minified");
        continue;
      }
      files.push({ path: rel, text });
    }
  };

  walk(root);
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
