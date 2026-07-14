/**
 * `pnpm bench` — the repeatable benchmark suite (SBS-090).
 *
 * Measures analysis time, layout time and heap use on three pinned synthetic
 * projects (small/medium/large) and prints a comparison table against:
 * - bench/budgets.json  — absolute ceilings, committed and documented; a
 *   breach fails the run (calibrated generously for GitHub ubuntu runners).
 * - bench/baseline.local.json — this machine's last `--update-baseline` run
 *   (gitignored); a > 20% regression against it fails the run.
 *
 * Usage:  node scripts/bench.mjs [--update-baseline] [--json <path>]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const core = await import(new URL(`file://${root}/packages/core/dist/index.js`).href);
const { syntheticProject } = await import(
  new URL(`file://${root}/packages/core/dist/bench/synthetic.js`).href
);
const { compareBench, formatComparison } = await import(
  new URL(`file://${root}/packages/core/dist/bench/compare.js`).href
);

const SIZES = { small: 50, medium: 200, large: 500 };

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

// Mirror the extension's readability guardrail: a workspace map folds to the
// folder level past 250 modules or 600 flat edges, so `layoutMs` measures the
// graph a user actually gets. `dense.layoutMs` keeps the raw hub-dense medium
// graph as a canary for the layout engine's dense-graph fallback path.
const MODULE_RENDER_BUDGET = 250;
const EDGE_RENDER_BUDGET = 600;
const flatEdges = (graph) => graph.edges.filter((edge) => edge.kind !== "contains").length;

const metrics = {};
let denseCanary;
for (const [size, moduleCount] of Object.entries(SIZES)) {
  const files = syntheticProject(moduleCount);

  const beforeHeap = process.memoryUsage().heapUsed;
  const analyzeStart = performance.now();
  const analyzed = core.analyzeTypeScriptProject(files);
  const analyzeMs = performance.now() - analyzeStart;
  const heapMB = Math.max(0, (process.memoryUsage().heapUsed - beforeHeap) / 1024 / 1024);

  const modules = core.collapseToModules(analyzed.graph);
  const rendered =
    modules.nodes.length > MODULE_RENDER_BUDGET || flatEdges(modules) > EDGE_RENDER_BUDGET
      ? core.collapseToFolders(analyzed.graph, 1)
      : modules;
  if (size === "medium") {
    denseCanary = modules;
  }
  const layoutStart = performance.now();
  await core.layoutGraph(rendered);
  const layoutMs = performance.now() - layoutStart;

  metrics[`${size}.analyzeMs`] = Math.round(analyzeMs);
  metrics[`${size}.layoutMs`] = Math.round(layoutMs);
  metrics[`${size}.heapMB`] = Math.round(heapMB);
  console.log(
    `${size}: ${files.length} files → ${analyzed.graph.nodes.length} nodes, analyze ${Math.round(analyzeMs)} ms, layout ${Math.round(layoutMs)} ms (${rendered === modules ? "modules" : "folded"}: ${rendered.nodes.length}n/${flatEdges(rendered)}e)`,
  );
}

{
  const start = performance.now();
  await core.layoutGraph(denseCanary);
  metrics["dense.layoutMs"] = Math.round(performance.now() - start);
  console.log(
    `dense canary: ${denseCanary.nodes.length}n/${flatEdges(denseCanary)}e → layout ${metrics["dense.layoutMs"]} ms`,
  );
}

const report = { metrics };
const budgets = readJson(resolve(root, "bench/budgets.json")) ?? {};
const baselinePath = resolve(root, "bench/baseline.local.json");
const baseline = readJson(baselinePath);

const comparison = compareBench(report, baseline, budgets);
console.log(`\n${formatComparison(comparison)}\n`);

const jsonAt = process.argv.indexOf("--json");
if (jsonAt !== -1 && process.argv[jsonAt + 1]) {
  writeFileSync(process.argv[jsonAt + 1], `${JSON.stringify(report, null, 2)}\n`);
}
if (process.argv.includes("--update-baseline")) {
  mkdirSync(dirname(baselinePath), { recursive: true });
  writeFileSync(baselinePath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`baseline written to ${baselinePath}`);
}
if (comparison.failures.length > 0) {
  console.error("Benchmark failures:");
  for (const failure of comparison.failures) {
    console.error(`  ${failure}`);
  }
  process.exit(1);
}
