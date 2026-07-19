import { jsonExporter } from "@surrounded-by-slop/core";
import { intOption, optionValue, type ParsedArgs, UsageError } from "../args.js";
import type { CommandContext } from "../context.js";
import { analyzeProject } from "../host/analyze.js";
import { gitDiff } from "../host/git.js";
import { parseUnifiedDiff } from "../impact/diff.js";
import { computeImpact, renderImpact } from "../impact/impact.js";
import { discoveryFrom, reportDiagnostics } from "./shared.js";

/**
 * `sbs impact [--staged | --diff <ref> | -]` — the blast radius of a change
 * (SBS-114). Answers "what does this diff reach?" for a human reviewer or an AI
 * review bot without reading the whole PR: changed symbols, their callers and
 * importers, and the tests in range. Analyzes with test files included so
 * affected tests actually surface.
 */
export function impactCommand(ctx: CommandContext, parsed: ParsedArgs): number {
  const depth = intOption(parsed, "depth", 2);
  const stdinMode = parsed.positionals.includes("-");
  const pathArg = parsed.positionals.find((operand) => operand !== "-");
  const root = pathArg ?? parsed.options.get("root")?.[0] ?? ctx.cwd;

  const diffText = readDiff(ctx, parsed, root, stdinMode);
  const changedLines = parseUnifiedDiff(diffText);

  const verbose = parsed.flags.has("verbose");
  const analysis = analyzeProject(root, {
    ...discoveryFrom(parsed),
    includeTests: true, // affected tests can only surface if tests are in the graph
    ...(verbose ? { onDiagnosticNote: (note: string) => ctx.writeError(`note: ${note}\n`) } : {}),
  });
  reportDiagnostics(ctx, analysis.diagnostics);

  const result = computeImpact(analysis.graph, changedLines, { depth });

  if (parsed.flags.has("json")) {
    ctx.write(jsonExporter.export(result.subgraph));
    return 0;
  }
  ctx.write(`${renderImpact(result, depth)}\n`);
  return 0;
}

function readDiff(
  ctx: CommandContext,
  parsed: ParsedArgs,
  root: string,
  stdinMode: boolean,
): string {
  if (stdinMode) {
    if (ctx.readStdin === undefined) {
      throw new UsageError("no stdin available for `impact -`");
    }
    return ctx.readStdin();
  }
  const ref = optionValue(parsed, "diff");
  if (parsed.flags.has("staged")) {
    return gitDiff(root, { staged: true });
  }
  if (ref !== undefined) {
    return gitDiff(root, { ref });
  }
  // No source given: the unstaged working-tree changes.
  return gitDiff(root, {});
}
