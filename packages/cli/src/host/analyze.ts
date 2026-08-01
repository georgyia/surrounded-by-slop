import { resolve } from "node:path";
import { type AnalysisResult, analyzeTypeScriptProject } from "@surrounded-by-slop/core";
import { discoverFiles } from "@surrounded-by-slop/host/discovery";
import { discoverAliasOptions } from "@surrounded-by-slop/host/tsconfig";
import type { DiscoverOptions } from "../public-host.js";

/**
 * The shared pipeline every command runs: discover files under a root, resolve
 * the project's path aliases, and hand both to the pure core. Keeping it in one
 * place means `map`, `query`, and `impact` all analyze a project identically.
 */

export interface AnalyzeProjectOptions extends DiscoverOptions {
  /** Surface why alias discovery found nothing (for `--verbose`). */
  onDiagnosticNote?: (note: string) => void;
}

export interface AnalyzeProjectResult extends AnalysisResult {
  /** Absolute project root that was analyzed. */
  root: string;
  /** Number of source files discovered and fed to the analyzer. */
  fileCount: number;
}

export function analyzeProject(
  rootInput: string,
  options: AnalyzeProjectOptions = {},
): AnalyzeProjectResult {
  const root = resolve(rootInput);
  const files = discoverFiles(root, options);

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

  const { graph, diagnostics } = analyzeTypeScriptProject(
    files,
    adapterOptions === undefined ? undefined : { adapterOptions },
  );
  return { graph, diagnostics, root, fileCount: files.length };
}
