import { builtinExporters } from "@surrounded-by-slop/core";
import { optionValue, type ParsedArgs, UsageError } from "../args.js";
import type { CommandContext } from "../context.js";
import { analyzeFor, reportDiagnostics } from "./shared.js";

/**
 * `sbs export --format <id> [path]` — analyze a project and render it through
 * one of the layout-free exporters.
 *
 * The set is derived, not restated (#132): every built-in exporter that needs
 * no layout is available here, and every one that does is not. Layout formats
 * (svg, drawio) need a positioned graph, which belongs to the extension rather
 * than a headless text pipe — and now that rule enforces itself, instead of
 * depending on someone remembering to extend a hardcoded list.
 */

/** The exporters a headless pipe can produce: everything that needs no layout. */
export const CLI_EXPORTERS = builtinExporters.filter((exporter) => !exporter.needsLayout);
export async function exportCommand(ctx: CommandContext, parsed: ParsedArgs): Promise<number> {
  const format = optionValue(parsed, "format") ?? "mermaid";
  const exporter = CLI_EXPORTERS.find((candidate) => candidate.id === format);
  if (exporter === undefined) {
    throw new UsageError(
      `unknown --format "${format}"; expected one of: ${CLI_EXPORTERS.map((e) => e.id).join(", ")}`,
    );
  }

  const root = parsed.positionals[0] ?? ctx.cwd;
  const result = await analyzeFor(ctx, parsed, root);
  reportDiagnostics(ctx, result.diagnostics);

  const direction = optionValue(parsed, "direction");
  const output = exporter.export(
    result.graph,
    direction === "TD" || direction === "LR" ? { direction } : undefined,
  );
  ctx.write(output.endsWith("\n") ? output : `${output}\n`);
  return 0;
}
