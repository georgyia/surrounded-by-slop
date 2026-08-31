import { resolve } from "node:path";
import {
  type AnalysisResult,
  analyzeTypeScriptProject,
  mergeAnalyses,
} from "@surrounded-by-slop/core";
import { discoverFiles } from "@surrounded-by-slop/host/discovery";
import { adaptersForPaths, isTypeScriptPath } from "@surrounded-by-slop/host/grammars";
import { discoverAliasOptions } from "@surrounded-by-slop/host/tsconfig";
import { MAX_PROJECT_FILES as DEFAULT_MAX_FILES, type DiscoverOptions } from "../public-host.js";

/**
 * The shared pipeline every command runs: discover files under a root, resolve
 * the project's path aliases, and hand both to the pure core. Keeping it in one
 * place means `map`, `query`, and `impact` all analyze a project identically.
 *
 * Each language is analyzed by its own adapter and the results are merged
 * (#131), so the CLI sees exactly what the editor does. It is async only
 * because a tree-sitter grammar has to be read from disk before it can parse;
 * once loaded, analysis itself is synchronous, and grammars load only for
 * languages the project actually contains.
 */

export interface AnalyzeProjectOptions extends DiscoverOptions {
  /** Surface why alias discovery found nothing (for `--verbose`). */
  onDiagnosticNote?: (note: string) => void;
  /** Always-visible warnings: things that changed the answer, not just notes. */
  onWarning?: (message: string) => void;
}

export interface AnalyzeProjectResult extends AnalysisResult {
  /** Absolute project root that was analyzed. */
  root: string;
  /** Number of source files discovered and fed to the analyzer. */
  fileCount: number;
}

export async function analyzeProject(
  rootInput: string,
  options: AnalyzeProjectOptions = {},
): Promise<AnalyzeProjectResult> {
  const root = resolve(rootInput);
  // A skipped file changes the answer, so it is never dropped silently. The
  // count cap always warns — it truncates the map — while per-file skips are
  // notes, since a repo can legitimately hold a few generated blobs.
  const files = discoverFiles(root, {
    ...options,
    onSkip: (path, reason) => {
      if (reason === "file-limit") {
        options.onWarning?.(
          `more than ${options.maxFiles ?? DEFAULT_MAX_FILES} files; mapped the first ${options.maxFiles ?? DEFAULT_MAX_FILES}, starting at ${path}. Narrow it with --include / --exclude.`,
        );
        return;
      }
      options.onDiagnosticNote?.(
        reason === "too-large"
          ? `skipped ${path} (too large)`
          : `skipped ${path} (looks generated)`,
      );
    },
  });

  const aliases = discoverAliasOptions(root);
  if (aliases.reason !== undefined && options.onDiagnosticNote !== undefined) {
    options.onDiagnosticNote(`path aliases: ${aliases.reason}`);
  }
  const adapterOptions =
    aliases.options === undefined
      ? undefined
      : {
          compilerOptions: {
            baseUrl: aliases.options.baseUrl,
            paths: aliases.options.paths,
          },
        };

  const results: AnalysisResult[] = [];
  const typescriptFiles = files.filter((file) => isTypeScriptPath(file.path));
  if (typescriptFiles.length > 0) {
    results.push(
      analyzeTypeScriptProject(
        typescriptFiles,
        adapterOptions === undefined ? undefined : { adapterOptions },
      ),
    );
  }
  for (const adapter of await adaptersForPaths(files.map((file) => file.path))) {
    const owned = files.filter((file) =>
      adapter.extensions.some((extension) => file.path.toLowerCase().endsWith(extension)),
    );
    if (owned.length > 0) {
      results.push(adapter.analyze(owned));
    }
  }

  const { graph, diagnostics } = mergeAnalyses(results);
  return { graph, diagnostics, root, fileCount: files.length };
}
