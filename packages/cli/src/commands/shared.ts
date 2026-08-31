import type { Diagnostic } from "@surrounded-by-slop/core";
import { DEFAULT_EXCLUDE, DEFAULT_INCLUDE, expandBraces } from "@surrounded-by-slop/host/decisions";
import { discoverFiles } from "@surrounded-by-slop/host/discovery";
import { EmptyProjectError, optionValues, type ParsedArgs } from "../args.js";
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
): Promise<AnalyzeProjectResult> {
  const verbose = parsed.flags.has("verbose");
  return analyzeProject(root, {
    ...discoveryFrom(parsed),
    onWarning: (message: string) => ctx.writeError(`warning: ${message}\n`),
    ...(verbose ? { onDiagnosticNote: (note: string) => ctx.writeError(`note: ${note}\n`) } : {}),
  });
}

/**
 * Report analysis diagnostics to stderr and decide the exit code. Errors are
 * reported but never fatal — a broken file yields a partial graph, matching the
 * extension's behavior (SBS-051). The command still exits 0.
 */
export function reportDiagnostics(
  ctx: CommandContext,
  diagnostics: readonly Diagnostic[],
  options: { verbose?: boolean } = {},
): void {
  for (const diagnostic of diagnostics) {
    // Informational diagnostics explain a deliberate omission rather than a
    // problem, so they are shown on request instead of ahead of every answer.
    if (diagnostic.severity === "info" && options.verbose !== true) {
      continue;
    }
    const where = diagnostic.file === undefined ? "" : `${diagnostic.file}: `;
    ctx.writeError(`${diagnostic.severity}: ${where}${diagnostic.message}\n`);
  }
}

/** The file extensions the analyzers understand, for a "here is what I looked for" message. */
function supportedExtensions(): string[] {
  return [...DEFAULT_INCLUDE]
    .flatMap((glob) => expandBraces(glob))
    .map((glob) => glob.slice(glob.lastIndexOf(".")))
    .filter((suffix, index, all) => all.indexOf(suffix) === index);
}

/**
 * Fail loudly when there was nothing to read (#138).
 *
 * An empty map is indistinguishable from a small one, so the commands that
 * answer questions about a project refuse to answer at all rather than hand
 * back a confident blank. The message names what was looked for and — where we
 * can tell — why the files that exist were passed over, because each cause has
 * a different fix.
 */
export function assertAnalyzable(
  result: { fileCount: number; root: string },
  parsed: ParsedArgs,
): void {
  if (result.fileCount > 0) {
    return;
  }
  const discovery = discoveryFrom(parsed);
  // Everything is a test file: a real and easily-fixed case, worth its own message.
  if (discovery.includeTests !== true) {
    const withTests = discoverFiles(result.root, { ...discovery, includeTests: true });
    if (withTests.length > 0) {
      throw new EmptyProjectError(
        `every analyzable file under ${result.root} looks like a test (${withTests.length} found); pass --include-tests to analyze them`,
      );
    }
  }
  const narrowed = optionValues(parsed, "include").length > 0;
  const hint = narrowed
    ? "--include narrowed everything away; widen it or drop it to use the defaults"
    : `pass --include '**/*.ext' to widen, or check the path`;
  throw new EmptyProjectError(
    `no analyzable files under ${result.root} (looked for ${supportedExtensions().join(", ")}); ${hint}`,
  );
}
