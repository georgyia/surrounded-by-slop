import { build } from "esbuild";

const production = process.argv.includes("--production");

await build({
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  bundle: true,
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: !production,
  minify: production,
});
