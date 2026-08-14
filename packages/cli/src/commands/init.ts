import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ParsedArgs } from "../args.js";
import type { CommandContext } from "../context.js";

/**
 * `sbs init` — teach an agent that this repo has a graph (SBS-116).
 *
 * Deliberately a *pointer*, not a dump. Generated agent files that restate
 * what the repo already says measurably hurt: they add cost and cut task
 * success, and value falls off past a short block. So this writes ~12 lines
 * that redirect the agent from grep to the graph, and never inlines a map —
 * the block teaches pull, it does not push content.
 */

export const START_MARKER = "<!-- sbs:agents:start -->";
export const END_MARKER = "<!-- sbs:agents:end -->";

/** The managed block. Everything between the markers is ours; nothing else is. */
export const AGENTS_BLOCK = [
  START_MARKER,
  "## Codebase structure — use the graph, not grep",
  "",
  "This repo has a semantic code graph. For structure questions, prefer:",
  "",
  "- `sbs map` — ranked overview of the load-bearing symbols (~2k tokens)",
  "- `sbs query callers <symbol>` / `callees <symbol>` — exact edges, not guesses",
  "- `sbs query importers <file>` — who depends on a file",
  "- `sbs query path <from> <to>` — how one symbol reaches another",
  "- `git diff | sbs impact -` — blast radius of a change",
  "",
  "Output is deterministic; add `--json` for machine-readable graph fragments.",
  END_MARKER,
].join("\n");

/** The documented Claude Code import that pulls AGENTS.md into its context. */
const CLAUDE_IMPORT = "@AGENTS.md";

interface FileChange {
  readonly path: string;
  readonly action: "created" | "updated" | "unchanged";
}

/**
 * Replace an existing block, or append one. Content outside the markers is
 * returned byte-identical — this file belongs to the user, not to us.
 */
export function applyBlock(existing: string | undefined): string {
  if (existing === undefined || existing.trim() === "") {
    return `${AGENTS_BLOCK}\n`;
  }
  const start = existing.indexOf(START_MARKER);
  const end = existing.indexOf(END_MARKER);
  if (start !== -1 && end !== -1 && end > start) {
    const before = existing.slice(0, start);
    const after = existing.slice(end + END_MARKER.length);
    return `${before}${AGENTS_BLOCK}${after}`;
  }
  // No block yet: append, keeping exactly one blank line as the seam.
  const separator = existing.endsWith("\n\n") ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
  return `${existing}${separator}${AGENTS_BLOCK}\n`;
}

/** True when the file already carries the current block verbatim. */
export function isCurrent(existing: string | undefined): boolean {
  return existing !== undefined && applyBlock(existing) === existing;
}

export function initCommand(ctx: CommandContext, parsed: ParsedArgs): number {
  const root = parsed.positionals[0] ?? ctx.cwd;
  const agentsPath = join(root, "AGENTS.md");
  const claudePath = join(root, "CLAUDE.md");
  const existing = existsSync(agentsPath) ? readFileSync(agentsPath, "utf8") : undefined;
  const check = parsed.flags.has("check");

  if (check) {
    if (isCurrent(existing)) {
      ctx.write("AGENTS.md is up to date.\n");
      return 0;
    }
    ctx.writeError(
      existing === undefined
        ? "AGENTS.md is missing the sbs block — run `sbs init`.\n"
        : "AGENTS.md's sbs block is missing or stale — run `sbs init`.\n",
    );
    return 1;
  }

  const changes: FileChange[] = [];
  const updated = applyBlock(existing);
  if (updated === existing) {
    changes.push({ path: "AGENTS.md", action: "unchanged" });
  } else {
    writeFileSync(agentsPath, updated);
    changes.push({ path: "AGENTS.md", action: existing === undefined ? "created" : "updated" });
  }

  // Claude Code reads CLAUDE.md, so a fresh repo gets one that imports
  // AGENTS.md. An existing CLAUDE.md is the user's — never edited, only
  // mentioned, and only when it does not already pull AGENTS.md in.
  if (!existsSync(claudePath)) {
    writeFileSync(claudePath, `${CLAUDE_IMPORT}\n`);
    changes.push({ path: "CLAUDE.md", action: "created" });
  } else if (!readFileSync(claudePath, "utf8").includes(CLAUDE_IMPORT)) {
    ctx.write(`CLAUDE.md exists — add "${CLAUDE_IMPORT}" to it so Claude Code reads AGENTS.md.\n`);
  }

  for (const change of changes) {
    ctx.write(`${change.action === "unchanged" ? "unchanged" : change.action}: ${change.path}\n`);
  }
  return 0;
}
