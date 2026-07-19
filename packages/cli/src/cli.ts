import { type ArgSpec, parseArgs, UsageError } from "./args.js";
import { analyzeCommand } from "./commands/analyze.js";
import { exportCommand } from "./commands/export.js";
import type { CommandContext } from "./context.js";

/**
 * Command dispatch. Each command is a pure `(ctx, parsed) => exitCode`, so the
 * whole surface is testable in-process (see `context.ts`). `bin.ts` is the only
 * place that touches the real process.
 */

type Command = (ctx: CommandContext, parsed: ReturnType<typeof parseArgs>) => number;

/** Flags that never consume a following value, across all commands. */
const BOOLEAN_FLAGS: ArgSpec = {
  booleans: ["json", "verbose", "include-tests", "help"],
};

const COMMANDS = new Map<string, Command>([
  ["analyze", analyzeCommand],
  ["export", exportCommand],
]);

const HELP = `sbs — headless code analysis for AI agents and CI

Usage: sbs <command> [path] [options]

Commands:
  analyze [path]                 Print the Semantic Graph as canonical JSON
  export --format mermaid|json   Render the graph in a text format

Options:
  --include <glob>               Replace the default include glob (repeatable)
  --exclude <glob>               Add an exclude on top of the defaults (repeatable)
  --include-tests                Analyze test files too (excluded by default)
  --verbose                      Print discovery notes to stderr
  --help                         Show this help

All analysis is local; nothing is sent anywhere.`;

export function run(argv: readonly string[], ctx: CommandContext): number {
  const [commandName, ...rest] = argv;

  if (commandName === undefined || commandName === "--help" || commandName === "help") {
    ctx.write(`${HELP}\n`);
    return 0;
  }

  const command = COMMANDS.get(commandName);
  if (command === undefined) {
    ctx.writeError(`unknown command "${commandName}"\n\n${HELP}\n`);
    return 2;
  }

  const parsed = parseArgs(rest, BOOLEAN_FLAGS);
  if (parsed.flags.has("help")) {
    ctx.write(`${HELP}\n`);
    return 0;
  }

  try {
    return command(ctx, parsed);
  } catch (error) {
    if (error instanceof UsageError) {
      ctx.writeError(`error: ${error.message}\n`);
      return 2;
    }
    const message = error instanceof Error ? error.message : String(error);
    ctx.writeError(`error: ${message}\n`);
    return 1;
  }
}
