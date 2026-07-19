import { jsonExporter } from "@surrounded-by-slop/core";
import type { ParsedArgs } from "../args.js";
import type { CommandContext } from "../context.js";
import { analyzeFor, reportDiagnostics } from "./shared.js";

/**
 * `sbs analyze [path]` — analyze a project and print its canonical Semantic
 * Graph as JSON. The escape hatch for anything built on top of the graph
 * (Rule 5): byte-stable output, straight from the reference `json` exporter.
 */
export function analyzeCommand(ctx: CommandContext, parsed: ParsedArgs): number {
  const root = parsed.positionals[0] ?? ctx.cwd;
  const result = analyzeFor(ctx, parsed, root);
  reportDiagnostics(ctx, result.diagnostics);
  ctx.write(jsonExporter.export(result.graph));
  return 0;
}
