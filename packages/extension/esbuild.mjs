import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { build, context } from "esbuild";

// tree-sitter wasm binaries ship next to the host bundle: the runtime from
// web-tree-sitter and the Python grammar (SBS-081) from @vscode/tree-sitter-wasm.
const require = createRequire(import.meta.url);
// Both wasm packages are core's dependencies; resolve them through core so
// the extension can't drift to a different version.
const coreDir = dirname(
  require.resolve("@surrounded-by-slop/core", { paths: [import.meta.dirname] }),
);
const fromCore = (spec) => require.resolve(spec, { paths: [coreDir] });
mkdirSync("dist", { recursive: true });
copyFileSync(fromCore("web-tree-sitter/web-tree-sitter.wasm"), "dist/web-tree-sitter.wasm");
copyFileSync(
  join(dirname(fromCore("@vscode/tree-sitter-wasm/package.json")), "wasm/tree-sitter-python.wasm"),
  "dist/tree-sitter-python.wasm",
);

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

// A background esbuild watch needs to announce its rebuild boundaries so the
// VS Code build task (see .vscode/tasks.json) knows when a rebuild finished.
const watchLogger = {
  name: "watch-logger",
  setup(esbuild) {
    esbuild.onStart(() => console.log("[watch] build started"));
    esbuild.onEnd(() => console.log("[watch] build finished"));
  },
};

const shared = {
  bundle: true,
  sourcemap: !production,
  minify: production,
  logLevel: "info",
  plugins: watch ? [watchLogger] : [],
};

// The extension host: Node, CommonJS, with the editor API kept external.
const host = {
  ...shared,
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  // `vscode` is provided by the host. `web-worker` is an optional elkjs
  // dependency it only touches when handed a `workerUrl` (we never do): the
  // require is guarded behind `require.resolve` in a try/catch, so leaving it
  // external keeps that graceful fallback intact instead of failing the build.
  external: ["vscode", "web-worker"],
  format: "cjs",
  platform: "node",
  target: "node20",
  // core reaches web-tree-sitter via dynamic `import()`, which resolves the
  // package's ESM build — whose import.meta plumbing breaks inside a CJS
  // bundle. Pin the host to the CJS build (createRequire resolves it above).
  alias: { "web-tree-sitter": fromCore("web-tree-sitter") },
};

// The webview UI: a self-contained browser bundle loaded inside the panel.
const webview = {
  ...shared,
  entryPoints: ["../webview/src/main.ts"],
  outfile: "dist/webview.js",
  format: "iife",
  platform: "browser",
  target: "es2022",
  // The webview imports pure helpers from core; tree-shaking (core is
  // sideEffects-free) keeps elkjs/typescript out of the emitted bundle, but
  // esbuild still *resolves* every import it parses — so elkjs's optional
  // `require("web-worker")` must be external here exactly as in the host,
  // and web-tree-sitter's node-only imports (`fs/promises`, `module`) too.
  external: ["web-worker", "fs/promises", "module"],
};

if (watch) {
  const contexts = await Promise.all([context(host), context(webview)]);
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log("esbuild: watching host + webview…");
} else {
  await Promise.all([build(host), build(webview)]);
}
