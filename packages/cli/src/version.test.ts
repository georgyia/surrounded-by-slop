import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { run } from "./cli.js";
import { bufferContext } from "./context.js";
import { VERSION } from "./version.js";

/**
 * A version string that lies is worse than none: it turns every bug report
 * that quotes it into a wrong lead (#146).
 */

const packageVersion = (): string => {
  const path = fileURLToPath(new URL("../package.json", import.meta.url));
  return (JSON.parse(readFileSync(path, "utf8")) as { version: string }).version;
};

describe("sbs --version", () => {
  it("prints a version and exits 0", async () => {
    for (const flag of ["--version", "-v", "version"]) {
      const ctx = bufferContext(process.cwd());
      expect(await run([flag], ctx), flag).toBe(0);
      expect(ctx.out().trim(), flag).toBe(VERSION);
      expect(ctx.err(), flag).toBe("");
    }
  });

  it("is listed in the help, so it is discoverable", async () => {
    const ctx = bufferContext(process.cwd());
    await run(["--help"], ctx);
    expect(ctx.out()).toContain("--version");
  });
});

describe("the reported version", () => {
  it("is the one in package.json once the bundler has inlined it", () => {
    // Under vitest the sources run unbundled, so VERSION is the dev fallback.
    // That fallback must be obviously not-a-release rather than a plausible
    // number, so a build that lost its `define` cannot pass unnoticed.
    if (VERSION === "0.0.0-dev") {
      expect(packageVersion()).not.toBe("0.0.0-dev");
      return;
    }
    expect(VERSION).toBe(packageVersion());
  });

  it("is what the MCP server reports to its clients", async () => {
    const { handleLine } = await import("./mcp/server.js");
    const deps = {
      tools: {
        graph: () => ({ schemaVersion: 1 as const, nodes: [], edges: [] }),
        graphWithTests: () => ({ schemaVersion: 1 as const, nodes: [], edges: [] }),
        gitDiff: () => "",
      },
      serverName: "surrounded-by-slop",
      serverVersion: VERSION,
    };
    const line = handleLine(deps, '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}');
    expect(line).toBeDefined();
    const response = JSON.parse(line ?? "{}") as {
      result: { serverInfo: { version: string } };
    };
    expect(response.result.serverInfo.version).toBe(VERSION);
  });
});
