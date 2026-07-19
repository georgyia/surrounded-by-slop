import type { SemanticGraph } from "@surrounded-by-slop/core";
import type { DiffSource } from "../host/git.js";
import { parseUnifiedDiff } from "../impact/diff.js";
import { computeImpact, renderImpact } from "../impact/impact.js";
import { renderMap } from "../map/render.js";
import { estimateTokens } from "../map/tokens.js";
import {
  answerDefs,
  answerImporters,
  answerPath,
  answerReach,
  answerSlice,
} from "../query/answers.js";

/**
 * The MCP tool set (SBS-115): the same map/query/impact answers the CLI serves,
 * wrapped as tools an agent can call. Every response is capped so one call can
 * never blow the caller's context window (ReCUBE: few, bounded, dense answers).
 */

/** What a tool needs from the running server: fresh graphs and a way to diff. */
export interface ToolContext {
  /** Current graph with tests excluded — for map and query. */
  graph(): SemanticGraph;
  /** Current graph with tests included — for impact, so affected tests surface. */
  graphWithTests(): SemanticGraph;
  /** Run git for `impact` when the caller asks for --staged / a ref. */
  gitDiff(source: DiffSource): string;
}

export interface ToolResult {
  text: string;
  isError?: boolean;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(ctx: ToolContext, args: Record<string, unknown>): ToolResult;
}

/** Cap ~1500 tokens so a single tool response stays context-window-friendly. */
const MAX_TOOL_TOKENS = 1500;

function cap(text: string): string {
  if (estimateTokens(text) <= MAX_TOOL_TOKENS) {
    return text;
  }
  const budgetChars = Math.floor(MAX_TOOL_TOKENS * 3.7);
  const clipped = text.slice(0, budgetChars).replace(/\n[^\n]*$/, "");
  return `${clipped}\n… (truncated at ~${MAX_TOOL_TOKENS} tokens; narrow with --depth or a tighter query)`;
}

function strArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

function numArg(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function boolArg(args: Record<string, unknown>, key: string): boolean {
  return args[key] === true;
}

function required(args: Record<string, unknown>, key: string): string {
  const value = strArg(args, key);
  if (value === undefined || value === "") {
    throw new Error(`missing required argument "${key}"`);
  }
  return value;
}

/** Turn an Answer into a ToolResult (errors become isError text). */
function fromAnswer(answer: ReturnType<typeof answerDefs>): ToolResult {
  return answer.ok ? { text: cap(answer.text) } : { text: answer.message, isError: true };
}

export const TOOLS: readonly McpTool[] = [
  {
    name: "repo_map",
    description:
      "Ranked, token-budgeted map of the codebase's load-bearing symbols. Start here to orient.",
    inputSchema: {
      type: "object",
      properties: { budget: { type: "number", description: "Token budget (default 2000)" } },
    },
    run(ctx, args) {
      return { text: cap(renderMap(ctx.graph(), { budget: numArg(args, "budget") ?? 2000 }).text) };
    },
  },
  {
    name: "find_symbol",
    description: "Find declarations whose name or qualified name matches a substring.",
    inputSchema: {
      type: "object",
      properties: { pattern: { type: "string" } },
      required: ["pattern"],
    },
    run(ctx, args) {
      return fromAnswer(answerDefs(ctx.graph(), required(args, "pattern")));
    },
  },
  {
    name: "callers",
    description: "Who calls this function, transitively. Optional depth bound.",
    inputSchema: {
      type: "object",
      properties: { symbol: { type: "string" }, depth: { type: "number" } },
      required: ["symbol"],
    },
    run(ctx, args) {
      const depth = numArg(args, "depth") ?? Number.POSITIVE_INFINITY;
      return fromAnswer(answerReach(ctx.graph(), required(args, "symbol"), depth, "callers"));
    },
  },
  {
    name: "callees",
    description: "What this function calls, transitively. Optional depth bound.",
    inputSchema: {
      type: "object",
      properties: { symbol: { type: "string" }, depth: { type: "number" } },
      required: ["symbol"],
    },
    run(ctx, args) {
      const depth = numArg(args, "depth") ?? Number.POSITIVE_INFINITY;
      return fromAnswer(answerReach(ctx.graph(), required(args, "symbol"), depth, "callees"));
    },
  },
  {
    name: "importers",
    description: "Which modules import a given file.",
    inputSchema: {
      type: "object",
      properties: { file: { type: "string" } },
      required: ["file"],
    },
    run(ctx, args) {
      return fromAnswer(answerImporters(ctx.graph(), required(args, "file")));
    },
  },
  {
    name: "slice",
    description: "The neighborhood of a symbol (its immediate graph context). Optional depth.",
    inputSchema: {
      type: "object",
      properties: { symbol: { type: "string" }, depth: { type: "number" } },
      required: ["symbol"],
    },
    run(ctx, args) {
      const depth = numArg(args, "depth") ?? 1;
      return fromAnswer(answerSlice(ctx.graph(), required(args, "symbol"), depth));
    },
  },
  {
    name: "path",
    description: "The shortest call/import chain from one symbol to another.",
    inputSchema: {
      type: "object",
      properties: { from: { type: "string" }, to: { type: "string" } },
      required: ["from", "to"],
    },
    run(ctx, args) {
      return fromAnswer(answerPath(ctx.graph(), required(args, "from"), required(args, "to")));
    },
  },
  {
    name: "impact",
    description:
      "Blast radius of a diff: changed symbols, their callers/importers, and affected tests. Pass a unified diff, or set staged/ref to diff via git.",
    inputSchema: {
      type: "object",
      properties: {
        diff: { type: "string", description: "A unified diff to analyze" },
        staged: { type: "boolean", description: "Diff the staged index against HEAD" },
        ref: { type: "string", description: "Diff the working tree against this ref" },
        depth: { type: "number", description: "Caller/importer hops (default 2)" },
      },
    },
    run(ctx, args) {
      const depth = numArg(args, "depth") ?? 2;
      const diffText = resolveDiff(ctx, args);
      const changed = parseUnifiedDiff(diffText);
      const result = computeImpact(ctx.graphWithTests(), changed, { depth });
      return { text: cap(renderImpact(result, depth)) };
    },
  },
];

function resolveDiff(ctx: ToolContext, args: Record<string, unknown>): string {
  const diff = strArg(args, "diff");
  if (diff !== undefined) {
    return diff;
  }
  if (boolArg(args, "staged")) {
    return ctx.gitDiff({ staged: true });
  }
  const ref = strArg(args, "ref");
  if (ref !== undefined) {
    return ctx.gitDiff({ ref });
  }
  return ctx.gitDiff({});
}

/** Dispatch a tool call by name. Returns undefined for an unknown tool. */
export function callTool(
  ctx: ToolContext,
  name: string,
  args: Record<string, unknown>,
): ToolResult | undefined {
  const tool = TOOLS.find((candidate) => candidate.name === name);
  if (tool === undefined) {
    return undefined;
  }
  try {
    return tool.run(ctx, args);
  } catch (error) {
    return { text: error instanceof Error ? error.message : String(error), isError: true };
  }
}
