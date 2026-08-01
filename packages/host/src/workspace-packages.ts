import { type Dirent, readdirSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";

/**
 * Monorepo support: teach the analyzer that `@scope/pkg` is a folder in this
 * repo, not a third-party dependency (#97).
 *
 * The core analyzer runs on a virtual filesystem holding only the analyzed
 * sources — it has no `node_modules` to resolve through, so a bare workspace
 * specifier always fell out as an external node and every cross-package edge
 * was lost. Rather than teach core about the disk, we hand it `paths` aliases
 * pointing each workspace package name at its source entry, which is exactly
 * the mechanism tsconfig aliases already use.
 *
 * Packages are found by scanning for `package.json` rather than by parsing
 * workspace globs, so pnpm, npm, yarn, Lerna and Nx layouts all work without
 * knowing which one is in play.
 */

/** Never descend into these — build output and vendored code are not sources. */
const SKIP_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".turbo",
  "vendor",
  "fixtures",
  "__fixtures__",
  "test-fixtures",
]);

/** Deep enough for `apps/<group>/<pkg>`, shallow enough to stay cheap. */
const MAX_DEPTH = 5;

/** Where a package keeps its sources, in preference order. */
const SOURCE_DIRECTORIES = ["src", "source", "lib", ""];
const ENTRY_BASENAMES = ["index", "main", "mod"];
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

export interface WorkspacePackage {
  name: string;
  /** Root-relative, forward-slashed path to the package's source entry. */
  entry: string;
  /** Root-relative source directory, for `<name>/*` subpath aliases. */
  sourceRoot: string;
}

function isDirectory(candidate: string): boolean {
  try {
    return statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function isFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function readPackageName(manifestPath: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (typeof parsed !== "object" || parsed === null) {
      return undefined;
    }
    const name = (parsed as { name?: unknown }).name;
    return typeof name === "string" && name.length > 0 ? name : undefined;
  } catch {
    return undefined;
  }
}

/** First source entry that actually exists on disk, or nothing. */
function findEntry(packageDir: string): { entry: string; sourceRoot: string } | undefined {
  for (const sourceDirectory of SOURCE_DIRECTORIES) {
    const sourceRoot = sourceDirectory === "" ? packageDir : path.join(packageDir, sourceDirectory);
    if (sourceDirectory !== "" && !isDirectory(sourceRoot)) {
      continue;
    }
    for (const basename of ENTRY_BASENAMES) {
      for (const extension of SOURCE_EXTENSIONS) {
        const entry = path.join(sourceRoot, `${basename}${extension}`);
        if (isFile(entry)) {
          return { entry, sourceRoot };
        }
      }
    }
  }
  return undefined;
}

function toRootRelative(workspaceRoot: string, target: string): string {
  return path.relative(workspaceRoot, target).split(path.sep).join("/");
}

/**
 * Every in-repo package that declares a name and has a source entry. The root
 * manifest is skipped: it names the repo, not an importable package.
 */
export function discoverWorkspacePackages(workspaceRoot: string): WorkspacePackage[] {
  const found = new Map<string, WorkspacePackage>();

  const walk = (directory: string, depth: number): void => {
    if (depth > MAX_DEPTH) {
      return;
    }
    let entries: Dirent[];
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    if (
      directory !== workspaceRoot &&
      entries.some((it) => it.isFile() && it.name === "package.json")
    ) {
      const manifest = path.join(directory, "package.json");
      const name = readPackageName(manifest);
      const located = name === undefined ? undefined : findEntry(directory);
      if (name !== undefined && located !== undefined && !found.has(name)) {
        found.set(name, {
          name,
          entry: toRootRelative(workspaceRoot, located.entry),
          sourceRoot: toRootRelative(workspaceRoot, located.sourceRoot),
        });
      }
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".") && !SKIP_DIRECTORIES.has(entry.name)) {
        walk(path.join(directory, entry.name), depth + 1);
      }
    }
  };
  walk(workspaceRoot, 0);

  return [...found.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * Workspace packages as tsconfig-style `paths`, anchored at the workspace root.
 * Both the bare name and a `<name>/*` subpath alias are emitted, so deep
 * imports like `@scope/pkg/tsconfig` land on a source file too.
 */
export function workspacePackagePaths(workspaceRoot: string): Record<string, string[]> {
  const paths: Record<string, string[]> = {};
  for (const workspacePackage of discoverWorkspacePackages(workspaceRoot)) {
    paths[workspacePackage.name] = [workspacePackage.entry];
    paths[`${workspacePackage.name}/*`] = [`${workspacePackage.sourceRoot}/*`];
  }
  return paths;
}
