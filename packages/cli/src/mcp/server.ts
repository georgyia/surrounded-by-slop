import { createInterface } from "node:readline";
import { createIncrementalAnalyzer } from "@surrounded-by-slop/core";
import { discoverFiles } from "../host/discovery.js";
import { type DiffSource, gitDiff } from "../host/git.js";
import { discoverAliasOptions } from "../host/tsconfig.js";
import { handleRpc, type ProtocolDeps, parseErrorResponse } from "./protocol.js";
import type { ToolContext } from "./tools.js";

/**
 * The stdio transport for `sbs mcp` (SBS-115). Newline-delimited JSON-RPC in,
 * newline-delimited JSON-RPC out. A long-lived process keeps two incremental
 * analyzers warm, so edits between calls re-analyze only the files that changed
 * (`createIncrementalAnalyzer`) — sub-second answers without an on-disk cache.
 */

const SERVER_NAME = "surrounded-by-slop";
const SERVER_VERSION = "0.0.1";

/**
 * Build the tool context for a project root: warm analyzers (one with tests for
 * `impact`, one without for map/query) and a git shim. Aliases are resolved once
 * at startup — they rarely change within a session.
 */
export function createToolContext(root: string): ToolContext {
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

  const analyze = (
    analyzer: ReturnType<typeof createIncrementalAnalyzer>,
    includeTests: boolean,
  ) => {
    const files = discoverFiles(root, { includeTests });
    return analyzer.analyze(files, analysisOptions).graph;
  };

  return {
    graph: () => analyze(mainAnalyzer, false),
    graphWithTests: () => analyze(testAnalyzer, true),
    gitDiff: (source: DiffSource) => gitDiff(root, source),
  };
}

export function serverDeps(root: string): ProtocolDeps {
  return { tools: createToolContext(root), serverName: SERVER_NAME, serverVersion: SERVER_VERSION };
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
