import { jsonExporter, type SemanticGraph, stableStringify } from "@surrounded-by-slop/core";
import { intOption, type ParsedArgs, UsageError } from "../args.js";
import type { CommandContext } from "../context.js";
import {
  type Answer,
  answerDefs,
  answerImporters,
  answerPath,
  answerReach,
  answerSlice,
} from "../query/answers.js";
import { analyzeFor, reportDiagnostics } from "./shared.js";

/**
 * `sbs query <sub> …` — the pull half of the agent interface (SBS-113). A thin
 * adapter: it parses arguments, calls the pure answer functions in
 * `query/answers.ts` (shared with the MCP tools), and renders text or `--json`.
 */

const SUBCOMMANDS = ["defs", "callers", "callees", "importers", "slice", "path"] as const;

export function queryCommand(ctx: CommandContext, parsed: ParsedArgs): number {
  const [sub, ...operands] = parsed.positionals;
  if (sub === undefined) {
    throw new UsageError(`query needs a subcommand: ${SUBCOMMANDS.join(", ")}`);
  }
  if (!SUBCOMMANDS.includes(sub as (typeof SUBCOMMANDS)[number])) {
    throw new UsageError(`unknown query "${sub}"; expected one of: ${SUBCOMMANDS.join(", ")}`);
  }

  const root = parsed.options.get("root")?.[0] ?? ctx.cwd;
  const result = analyzeFor(ctx, parsed, root);
  reportDiagnostics(ctx, result.diagnostics);
  const graph = result.graph;
  const depth = intOption(parsed, "depth", Number.POSITIVE_INFINITY);

  const operand = (index: number, name: string): string => {
    const value = operands[index];
    if (value === undefined) {
      throw new UsageError(`missing <${name}>`);
    }
    return value;
  };

  let answer: Answer;
  switch (sub) {
    case "defs":
      answer = answerDefs(graph, operand(0, "pattern"));
      break;
    case "callers":
      answer = answerReach(graph, operand(0, "symbol"), depth, "callers");
      break;
    case "callees":
      answer = answerReach(graph, operand(0, "symbol"), depth, "callees");
      break;
    case "importers":
      answer = answerImporters(graph, operand(0, "file"));
      break;
    case "slice":
      answer = answerSlice(graph, operand(0, "symbol"), depth);
      break;
    default:
      answer = answerPath(graph, operand(0, "from"), operand(1, "to"));
      break;
  }

  return emit(ctx, answer, parsed.flags.has("json"));
}

function emit(ctx: CommandContext, answer: Answer, json: boolean): number {
  if (!answer.ok) {
    ctx.writeError(`${answer.message}\n`);
    return 1;
  }
  if (json) {
    ctx.write(jsonPayload(answer.graph, answer.ids));
    return 0;
  }
  ctx.write(`${answer.text}\n`);
  return 0;
}

function jsonPayload(graph: SemanticGraph | undefined, ids: string[] | undefined): string {
  if (graph !== undefined) {
    return jsonExporter.export(graph);
  }
  return `${stableStringify(ids ?? null, 2)}\n`;
}
