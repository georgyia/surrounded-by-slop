import type { ParsedArgs } from "../args.js";
import type { CommandContext } from "../context.js";
import { serverDeps, startStdioServer } from "../mcp/server.js";

/**
 * `sbs mcp [path]` — run the Model Context Protocol server over stdio (SBS-115),
 * so Claude Code / Cursor call map, query, and impact natively instead of
 * shelling out and parsing text. The process stays alive until stdin closes;
 * `run()` returns 0 while the stdin listener keeps the event loop running.
 * Local only — no sockets, no network (Rule 9).
 */
export function mcpCommand(ctx: CommandContext, parsed: ParsedArgs): number {
  const root = parsed.positionals[0] ?? parsed.options.get("root")?.[0] ?? ctx.cwd;
  startStdioServer(serverDeps(root));
  return 0;
}
