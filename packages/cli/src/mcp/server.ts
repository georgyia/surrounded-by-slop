import { createInterface } from "node:readline";
import {
  createIncrementalAnalyzer,
  type LanguageAdapter,
  mergeAnalyses,
} from "@surrounded-by-slop/core";
import { discoverFiles } from "@surrounded-by-slop/host/discovery";
import { adaptersForPaths, isTypeScriptPath } from "@surrounded-by-slop/host/grammars";
import { discoverAliasOptions } from "@surrounded-by-slop/host/tsconfig";
import { type DiffSource, gitDiff } from "../host/git.js";
import { VERSION } from "../version.js";
import { handleRpc, type ProtocolDeps, parseErrorResponse } from "./protocol.js";
import type { ToolContext } from "./tools.js";

/**
 * The stdio transport for `sbs mcp` (SBS-115). Newline-delimited JSON-RPC in,
 * newline-delimited JSON-RPC out. A long-lived process keeps two incremental
 * analyzers warm, so edits between calls re-analyze only the files that changed
 * (`createIncrementalAnalyzer`) — sub-second answers without an on-disk cache.
 */

const SERVER_NAME = "surrounded-by-slop";
// Reported to every MCP client during initialize, so it must be the real one
// (#146) — a client showing a stale version makes a bug report misleading.
const SERVER_VERSION = VERSION;

/**
 * Build the tool context for a project root: warm analyzers (one with tests for
 * `impact`, one without for map/query) and a git shim. Aliases are resolved once
 * at startup — they rarely change within a session.
 *
 * Tree-sitter grammars are loaded once here too (#131), which is the only
 * reason this is async: with the adapters in hand, answering a tool call stays
 * synchronous, so the JSON-RPC loop never has to await.
 */
export async function createToolContext(root: string): Promise<ToolContext> {
  const aliases = discoverAliasOptions(root);
  const analysisOptions =
    aliases.options === undefined
      ? undefined
      : {
          adapterOptions: {
            compilerOptions: { baseUrl: aliases.options.baseUrl, paths: aliases.options.paths },
          },
        };
  const mainAnalyzer = createIncrementalAnalyzer();
  const testAnalyzer = createIncrementalAnalyzer();
  // Load grammars for whatever this project actually contains, once. Only the
  // TypeScript half is incremental; the tree-sitter languages re-parse per
  // call, which is cheap and keeps their adapters stateless.
  const adapters: readonly LanguageAdapter[] = await adaptersForPaths(
    discoverFiles(root, { includeTests: true }).map((file) => file.path),
  );

  const analyze = (
    analyzer: ReturnType<typeof createIncrementalAnalyzer>,
    includeTests: boolean,
  ) => {
    const files = discoverFiles(root, { includeTests });
    const typescriptFiles = files.filter((file) => isTypeScriptPath(file.path));
    const results = [analyzer.analyze(typescriptFiles, analysisOptions)];
    for (const adapter of adapters) {
      const owned = files.filter((file) =>
        adapter.extensions.some((extension) => file.path.toLowerCase().endsWith(extension)),
      );
      if (owned.length > 0) {
        results.push(adapter.analyze(owned));
      }
    }
    return mergeAnalyses(results).graph;
  };

  return {
    graph: () => analyze(mainAnalyzer, false),
    graphWithTests: () => analyze(testAnalyzer, true),
    gitDiff: (source: DiffSource) => gitDiff(root, source),
  };
}

export async function serverDeps(root: string): Promise<ProtocolDeps> {
  return {
    tools: await createToolContext(root),
    serverName: SERVER_NAME,
    serverVersion: SERVER_VERSION,
  };
}

/**
 * Process one line of input. Returns the serialized response line, or undefined
 * for a notification or a blank line (nothing to answer).
 */
export function handleLine(deps: ProtocolDeps, line: string): string | undefined {
  const trimmed = line.trim();
  if (trimmed === "") {
    return undefined;
  }
  let message: unknown;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return `${JSON.stringify(parseErrorResponse())}\n`;
  }
  const response = handleRpc(deps, message);
  return response === undefined ? undefined : `${JSON.stringify(response)}\n`;
}

/** Run the server against arbitrary streams — the seam that makes it testable. */
export function runStdioServer(
  deps: ProtocolDeps,
  input: NodeJS.ReadableStream,
  write: (text: string) => void,
): Promise<void> {
  const rl = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
  rl.on("line", (line) => {
    const response = handleLine(deps, line);
    if (response !== undefined) {
      write(response);
    }
  });
  return new Promise((resolve) => rl.on("close", resolve));
}

/** Wire the server to the real process streams; keeps running until stdin closes. */
export function startStdioServer(deps: ProtocolDeps): void {
  void runStdioServer(deps, process.stdin, (text) => process.stdout.write(text));
}
