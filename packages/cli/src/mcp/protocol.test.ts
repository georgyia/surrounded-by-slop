import { analyzeTypeScriptProject } from "@surrounded-by-slop/core";
import { describe, expect, it } from "vitest";
import { handleRpc, PROTOCOL_VERSION, type ProtocolDeps } from "./protocol.js";
import type { ToolContext } from "./tools.js";

const { graph } = analyzeTypeScriptProject([
  {
    path: "src/a.ts",
    text: ["export function hub() {}", "export function caller() { hub(); }"].join("\n"),
  },
]);

const tools: ToolContext = {
  graph: () => graph,
  graphWithTests: () => graph,
  gitDiff: () => "",
};

const deps: ProtocolDeps = { tools, serverName: "test", serverVersion: "9.9.9" };

describe("handleRpc", () => {
  it("responds to initialize with the protocol version and server info", () => {
    const res = handleRpc(deps, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(res?.result).toMatchObject({
      protocolVersion: PROTOCOL_VERSION,
      serverInfo: { name: "test", version: "9.9.9" },
    });
  });

  it("lists all tools with input schemas", () => {
    const res = handleRpc(deps, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    const list = res?.result as { tools: Array<{ name: string; inputSchema: unknown }> };
    expect(list.tools.map((t) => t.name)).toContain("repo_map");
    expect(list.tools.length).toBe(8);
    expect(list.tools.every((t) => typeof t.inputSchema === "object")).toBe(true);
  });

  it("calls a tool and returns MCP text content", () => {
    const res = handleRpc(deps, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "callers", arguments: { symbol: "hub" } },
    });
    const result = res?.result as { content: Array<{ type: string; text: string }> };
    expect(result.content[0]?.text).toContain("caller");
  });

  it("returns an error result (not a crash) for a bad symbol", () => {
    const res = handleRpc(deps, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "callers", arguments: { symbol: "ghost" } },
    });
    const result = res?.result as { isError?: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("no symbol matching");
  });

  it("returns no response for a notification (no id)", () => {
    expect(
      handleRpc(deps, { jsonrpc: "2.0", method: "notifications/initialized" }),
    ).toBeUndefined();
  });

  it("rejects an unknown tool with invalid params", () => {
    const res = handleRpc(deps, {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "nope", arguments: {} },
    });
    expect(res?.error?.code).toBe(-32602);
  });

  it("rejects an unknown method", () => {
    const res = handleRpc(deps, { jsonrpc: "2.0", id: 6, method: "does/not/exist" });
    expect(res?.error?.code).toBe(-32601);
  });

  it("rejects a malformed request (missing jsonrpc)", () => {
    const res = handleRpc(deps, { id: 7, method: "initialize" });
    expect(res?.error?.code).toBe(-32600);
  });
});
