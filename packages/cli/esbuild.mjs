import { readFileSync } from "node:fs";
import { build } from "esbuild";

/**
 * The version is inlined at build time (#146) rather than read at runtime, so
 * the published bin never reaches for package.json — it behaves the same from
 * dist/, a global install, or npx — and the CLI and the MCP server can never
 * report different versions.
 */
const { version } = JSON.parse(readFileSync("package.json", "utf8"));

await build({
  entryPoints: {
    bin: "src/bin.ts",
    index: "src/index.ts",
  },
  outdir: "dist",
  bundle: true,
  external: ["@surrounded-by-slop/core", "typescript"],
  format: "esm",
  platform: "node",
  target: "node20",
  sourcemap: false,
  define: { __SBS_VERSION__: JSON.stringify(version) },
  logLevel: "info",
});
