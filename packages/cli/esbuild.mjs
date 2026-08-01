import { build } from "esbuild";

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
  logLevel: "info",
});
