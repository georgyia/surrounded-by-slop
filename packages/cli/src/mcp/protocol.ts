import { callTool, TOOLS, type ToolContext } from "./tools.js";

/**
 * A minimal, hand-rolled MCP handler over JSON-RPC 2.0 (SBS-115). Implements the
 * three methods an agent needs — `initialize`, `tools/list`, `tools/call` — plus
 * the `initialized` notification and `ping`. No SDK dependency (Rule 3): the
 * tools-only subset is a few hundred lines we own. If resources, prompts, or
 * streaming are ever needed, that is the moment to reconsider the official SDK.
 *
 * Pure: a parsed message in, a response (or nothing, for notifications) out —
 * so the whole protocol is unit-testable without a pipe.
 */

/** The MCP revision we speak. Clients requesting another string negotiate down to this. */
export const PROTOCOL_VERSION = "2025-06-18";

export interface ProtocolDeps {
  tools: ToolContext;
  serverName: string;
  serverVersion: string;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

function ok(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function fail(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Handle one parsed JSON-RPC message. Returns a response, or `undefined` for a
 * notification (a message with no `id`), which by spec gets no reply.
 */
export function handleRpc(deps: ProtocolDeps, message: unknown): JsonRpcResponse | undefined {
  if (!isObject(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return fail(readId(message), INVALID_REQUEST, "invalid JSON-RPC request");
  }
  const method = message.method;
  const id = readId(message);
  const isNotification = !("id" in message);
  const params = isObject(message.params) ? message.params : {};

  // Notifications (no id) never get a response.
  if (isNotification) {
    return undefined;
  }

  switch (method) {
    case "initialize":
      return ok(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: deps.serverName, version: deps.serverVersion },
      });
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, {
        tools: TOOLS.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      });
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : undefined;
      if (name === undefined) {
        return fail(id, INVALID_PARAMS, "tools/call requires a string 'name'");
      }
      const args = isObject(params.arguments) ? params.arguments : {};
      const result = callTool(deps.tools, name, args);
      if (result === undefined) {
        return fail(id, INVALID_PARAMS, `unknown tool: ${name}`);
      }
      return ok(id, {
        content: [{ type: "text", text: result.text }],
        ...(result.isError === true ? { isError: true } : {}),
      });
    }
    default:
      return fail(id, METHOD_NOT_FOUND, `unknown method: ${method}`);
  }
}

/** A JSON-RPC id must be a string, number, or null; anything else reads as null. */
function readId(message: unknown): string | number | null {
  if (isObject(message) && (typeof message.id === "string" || typeof message.id === "number")) {
    return message.id;
  }
  return null;
}

/** Parse errors surface with a null id per the JSON-RPC spec. */
export function parseErrorResponse(): JsonRpcResponse {
  return fail(null, PARSE_ERROR, "parse error");
}
