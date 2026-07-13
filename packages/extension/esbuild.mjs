import { build, context } from "esbuild";

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
  // `require("web-worker")` must be external here exactly as in the host.
  external: ["web-worker"],
};

if (watch) {
  const contexts = await Promise.all([context(host), context(webview)]);
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log("esbuild: watching host + webview…");
} else {
  await Promise.all([build(host), build(webview)]);
}
