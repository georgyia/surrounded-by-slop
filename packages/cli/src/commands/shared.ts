import type { Diagnostic } from "@surrounded-by-slop/core";
import { DEFAULT_EXCLUDE } from "@surrounded-by-slop/host/decisions";
import { optionValues, type ParsedArgs } from "../args.js";
import type { CommandContext } from "../context.js";
import { type AnalyzeProjectResult, analyzeProject } from "../host/analyze.js";

/**
 * Discovery options shared by every command, read from the common flags.
 * `--include` replaces the default set (so you can narrow to one language);
 * `--exclude` extends the defaults (so you add one more folder to ignore without
 * losing the node_modules/dist/fixtures guards).
 */
export function discoveryFrom(parsed: ParsedArgs): {
  include?: string[];
  exclude?: string[];
  includeTests?: boolean;
} {
  const include = optionValues(parsed, "include");
  const exclude = optionValues(parsed, "exclude");
  return {
    ...(include.length > 0 ? { include } : {}),
    ...(exclude.length > 0 ? { exclude: [...DEFAULT_EXCLUDE, ...exclude] } : {}),
    ...(parsed.flags.has("include-tests") ? { includeTests: true } : {}),
  };
}

/** Run the analysis pipeline for a command, wiring `--verbose` notes to stderr. */
export function analyzeFor(
  ctx: CommandContext,
  parsed: ParsedArgs,
  root: string,
): AnalyzeProjectResult {
  const verbose = parsed.flags.has("verbose");
  return analyzeProject(root, {
    ...discoveryFrom(parsed),
    ...(verbose ? { onDiagnosticNote: (note: string) => ctx.writeError(`note: ${note}\n`) } : {}),
  });
}

/**
 * Report analysis diagnostics to stderr and decide the exit code. Errors are
 * reported but never fatal — a broken file yields a partial graph, matching the
 * extension's behavior (SBS-051). The command still exits 0.
 */
export function reportDiagnostics(ctx: CommandContext, diagnostics: readonly Diagnostic[]): void {
  for (const diagnostic of diagnostics) {
    const where = diagnostic.file === undefined ? "" : `${diagnostic.file}: `;
    ctx.writeError(`${diagnostic.severity}: ${where}${diagnostic.message}\n`);
  }
}
