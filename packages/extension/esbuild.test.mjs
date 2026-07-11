import { build } from "esbuild";

// The integration tests run in two places: the launcher (`runTest`) in plain
// Node, and the suite inside the Extension Development Host. Both are compiled
// to `dist/test/`, mirroring the `src/test/` layout. `vscode` is provided by
// the host; `@vscode/test-electron` is a Node dependency of the launcher only.
await build({
  entryPoints: ["src/test/runTest.ts", "src/test/suite/index.ts"],
  outdir: "dist/test",
  outbase: "src/test",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  sourcemap: true,
  external: ["vscode", "@vscode/test-electron"],
});
