import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { analyzeTypeScriptProject } from "@surrounded-by-slop/core";
import { describe, expect, it } from "vitest";
import type { ProtocolDeps } from "./protocol.js";
import { createToolContext, handleLine, runStdioServer, serverDeps } from "./server.js";
import type { ToolContext } from "./tools.js";

const { graph } = analyzeTypeScriptProject([
  {
    path: "src/a.ts",
    text: ["export function hub() {}", "export function caller() { hub(); }"].join("\n"),
  },
]);

const staticDeps: ProtocolDeps = {
  tools: {
    graph: () => graph,
    graphWithTests: () => graph,
    gitDiff: () => "",
  } satisfies ToolContext,
  serverName: "test",
  serverVersion: "0",
};

describe("handleLine", () => {
  it("ignores blank lines", () => {
    expect(handleLine(staticDeps, "   ")).toBeUndefined();
  });

  it("returns a parse-error response for invalid JSON", () => {
    const line = handleLine(staticDeps, "{not json");
    expect(line).toBeDefined();
    expect(JSON.parse(line ?? "").error.code).toBe(-32700);
  });

  it("returns undefined for a notification", () => {
    expect(
      handleLine(staticDeps, '{"jsonrpc":"2.0","method":"notifications/initialized"}'),
    ).toBeUndefined();
  });
});

describe("runStdioServer", () => {
  it("answers a stream of JSON-RPC requests in order", async () => {
    const input = Readable.from([
      '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n',
      '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"callers","arguments":{"symbol":"hub"}}}\n',
    ]);
    let out = "";
    await runStdioServer(staticDeps, input, (text) => {
      out += text;
    });
    const responses = out
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(responses[0].result.serverInfo.name).toBe("test");
    expect(responses[1].result.content[0].text).toContain("caller");
  });
});

describe("createToolContext — warm analyzer reflects edits between calls", () => {
  it("picks up a new function added between calls", () => {
    const root = mkdtempSync(join(tmpdir(), "sbs-mcp-warm-"));
    try {
      writeFileSync(join(root, "m.ts"), "export function first() {}");
      const ctx = createToolContext(root);
      const before = ctx.graph().nodes.map((n) => n.name);
      expect(before).toContain("first");
      expect(before).not.toContain("second");

      writeFileSync(join(root, "m.ts"), "export function first() {}\nexport function second() {}");
      const after = ctx.graph().nodes.map((n) => n.name);
      expect(after).toContain("second"); // re-analyzed on the next call
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("serverDeps", () => {
  it("builds deps with the server identity", () => {
    const deps = serverDeps(process.cwd());
    expect(deps.serverName).toBe("surrounded-by-slop");
    expect(typeof deps.tools.graph).toBe("function");
  });
});
