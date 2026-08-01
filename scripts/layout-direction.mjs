/**
 * `pnpm bench:layout-direction` — compare RIGHT vs DOWN on real module maps.
 * The result is evidence for the workspace-map default, not a CI performance
 * gate: crossings and aspect ratio are deterministic for a given graph.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const core = await import(pathToFileURL(join(root, "packages/core/dist/index.js")).href);
const { orientationMetrics } = await import(
  pathToFileURL(join(root, "packages/core/dist/bench/orientation.js")).href
);
const { discoverFiles } = await import(
  pathToFileURL(join(root, "packages/host/dist/discovery.js")).href
);
const { discoverAliasOptions } = await import(
  pathToFileURL(join(root, "packages/host/dist/tsconfig.js")).href
);

const targets = [
  ["this repo", root],
  ["orders example", join(root, "examples/orders-app")],
].filter(([, directory]) => existsSync(directory));

const rows = [];
for (const [name, directory] of targets) {
  const files = discoverFiles(directory);
  const aliases = discoverAliasOptions(directory);
  const analyzed = core.analyzeTypeScriptProject(
    files.filter((file) => !file.path.endsWith(".py")),
    aliases.options === undefined
      ? undefined
      : { adapterOptions: { compilerOptions: aliases.options } },
  );
  const kept = new Set(
    analyzed.graph.nodes.filter((node) => node.external !== true).map((node) => node.id),
  );
  const internal = core.canonicalizeGraph({
    schemaVersion: analyzed.graph.schemaVersion,
    nodes: analyzed.graph.nodes.filter((node) => kept.has(node.id)),
    edges: analyzed.graph.edges.filter((edge) => kept.has(edge.from) && kept.has(edge.to)),
  });
  const modules = core.collapseToModules(internal);
  const flatEdges = modules.edges.filter((edge) => edge.kind !== "contains").length;
  const graph =
    modules.nodes.length > 250 || flatEdges > 600 ? core.collapseToFolders(internal, 1) : modules;
  const view = graph === modules ? "modules" : "folders";
  for (const direction of ["RIGHT", "DOWN"]) {
    const metrics = orientationMetrics(await core.layoutGraph(graph, { direction }));
    rows.push({
      name,
      view,
      direction,
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      ...metrics,
    });
  }
}

console.table(
  rows.map(({ name, view, direction, nodes, edges, crossings, aspectRatio, width, height }) => ({
    graph: name,
    view,
    direction,
    nodes,
    edges,
    crossings,
    aspect: aspectRatio.toFixed(2),
    bounds: `${Math.round(width)}×${Math.round(height)}`,
  })),
);

const jsonAt = process.argv.indexOf("--json");
if (jsonAt !== -1 && process.argv[jsonAt + 1]) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(process.argv[jsonAt + 1], `${JSON.stringify(rows, null, 2)}\n`);
}
