import { type ArgSpec, EmptyProjectError, parseArgs, UsageError } from "./args.js";
import { analyzeCommand } from "./commands/analyze.js";
import { exportCommand } from "./commands/export.js";
import { impactCommand } from "./commands/impact.js";
import { initCommand } from "./commands/init.js";
import { mapCommand } from "./commands/map.js";
import { mcpCommand } from "./commands/mcp.js";
import { queryCommand } from "./commands/query.js";
import type { CommandContext } from "./context.js";
import { VERSION } from "./version.js";

/**
 * Command dispatch. Each command is a pure `(ctx, parsed) => exitCode`, so the
 * whole surface is testable in-process (see `context.ts`). `bin.ts` is the only
 * place that touches the real process.
 */

type Command = (
  ctx: CommandContext,
  parsed: ReturnType<typeof parseArgs>,
) => number | Promise<number>;

/** Flags that never consume a following value, across all commands. */
const BOOLEAN_FLAGS: ArgSpec = {
  booleans: ["json", "verbose", "include-tests", "staged", "check", "help"],
};

const COMMANDS = new Map<string, Command>([
  ["analyze", analyzeCommand],
  ["export", exportCommand],
  ["map", mapCommand],
  ["query", queryCommand],
  ["impact", impactCommand],
  ["mcp", mcpCommand],
  ["init", initCommand],
]);

const HELP = `sbs — headless code analysis for AI agents and CI

Usage: sbs <command> [path] [options]

Commands:
  map [path]                     Ranked, token-budgeted repo map for AI agents
  query <sub> <symbol>           Ask the graph instead of grepping:
                                   defs <pattern>        matching declarations
                                   callers <symbol>      who calls it (--depth k)
                                   callees <symbol>      what it calls (--depth k)
                                   importers <file>      who imports the file
                                   slice <symbol>        neighborhood (--depth k)
                                   path <from> <to>      shortest call/import chain
  impact [--staged|--diff <ref>|-]  Blast radius of a diff (callers, tests)
  mcp [path]                     Run the MCP server over stdio (for AI agents)
  init [path]                    Add the agent pointer block to AGENTS.md
  analyze [path]                 Print the Semantic Graph as canonical JSON
  export --format <id>           Render the graph as text:
                                   mermaid | json | dot | plantuml

Options:
  --budget <tokens>              Token budget for the map (default 2000)
  --depth <k>                    Hops for callers/callees/slice/impact (impact: 2)
  --staged                       impact: diff the staged index against HEAD
  --diff <ref>                   impact: diff the working tree against a ref
  --root <path>                  Project root for query/impact (default: cwd)
  --json                         Emit canonical IR JSON instead of text
  --include <glob>               Replace the default include glob (repeatable)
  --exclude <glob>               Add an exclude on top of the defaults (repeatable)
  --include-tests                Analyze test files too (excluded by default)
  --check                        init: exit 1 if the AGENTS.md block is stale
  --verbose                      Print discovery notes to stderr
  --help                         Show this help
  --version                      Print the version and exit

Exit codes:
  0  success
  1  a command failed (bad diff, unreadable file, …)
  2  usage error (unknown command, bad flag)
  3  nothing analyzable found — the path, the filters, or the language

All analysis is local; nothing is sent anywhere.`;

export async function run(argv: readonly string[], ctx: CommandContext): Promise<number> {
  const [commandName, ...rest] = argv;

  if (commandName === undefined || commandName === "--help" || commandName === "help") {
    ctx.write(`${HELP}\n`);
    return 0;
  }

  if (commandName === "--version" || commandName === "-v" || commandName === "version") {
    ctx.write(`${VERSION}\n`);
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
    return await command(ctx, parsed);
  } catch (error) {
    if (error instanceof UsageError) {
      ctx.writeError(`error: ${error.message}\n`);
      return 2;
    }
    // Its own code: "I could not read this project" must be distinguishable
    // from "I read it and there is nothing to say" (#138).
    if (error instanceof EmptyProjectError) {
      ctx.writeError(`error: ${error.message}\n`);
      return 3;
    }
    const message = error instanceof Error ? error.message : String(error);
    ctx.writeError(`error: ${message}\n`);
    return 1;
  }
}
