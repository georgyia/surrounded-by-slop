import { intOption, type ParsedArgs, UsageError } from "../args.js";
import type { CommandContext } from "../context.js";
import { renderMap } from "../map/render.js";
import { analyzeFor, assertAnalyzable, reportDiagnostics } from "./shared.js";

/**
 * `sbs map [path] [--budget <tokens>]` — the token-budgeted repo map: the
 * codebase's load-bearing symbols, ranked and cut to fit an agent's context
 * window. The push half of the agent interface (SBS-112).
 */
export async function mapCommand(ctx: CommandContext, parsed: ParsedArgs): Promise<number> {
  const budget = intOption(parsed, "budget", 2000);
  if (budget <= 0) {
    throw new UsageError(`--budget must be positive, got ${budget}`);
  }
  const root = parsed.positionals[0] ?? ctx.cwd;
  const result = await analyzeFor(ctx, parsed, root);
  assertAnalyzable(result, parsed);
  reportDiagnostics(ctx, result.diagnostics);
  ctx.write(renderMap(result.graph, { budget }).text);
  return 0;
}
