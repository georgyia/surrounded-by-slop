/**
 * `pnpm docs:diagrams` — regenerate the architecture diagrams in
 * docs/architecture.md using the tool itself (SBS-101). Each package's module
 * map is analyzed by core and exported as Mermaid, then spliced between the
 * `<!-- diagram:<name> -->` markers. Drift-proof: if the code changes shape,
 * rerunning this script changes the docs.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const core = await import(new URL(`file://${root}/packages/core/dist/index.js`).href);
const { discoverFiles } = await import(
  new URL(`file://${root}/packages/host/dist/discovery.js`).href
);

function sourcesOf(packageDir) {
  // Preserve the historic docs input exactly: package-local fixtures are part
  // of the architecture diagram; only test files are omitted.
  return discoverFiles(join(packageDir, "src"), { include: ["**/*.ts"], exclude: [] });
}

function moduleDiagram(packageName) {
  const files = sourcesOf(join(root, "packages", packageName));
  const { graph } = core.analyzeTypeScriptProject(files);
  const modules = core.collapseToModules(graph);
  // Internal shape only: external packages would drown the picture.
  const internal = core.filterGraph(modules, { exclude: [] });
  const kept = new Set(
    internal.nodes.filter((node) => node.external !== true).map((node) => node.id),
  );
  const pruned = core.canonicalizeGraph({
    schemaVersion: modules.schemaVersion,
    nodes: modules.nodes.filter((node) => kept.has(node.id)),
    edges: modules.edges.filter((edge) => kept.has(edge.from) && kept.has(edge.to)),
  });
  return core.mermaidExporter.export(pruned).trim();
}

const target = join(root, "docs/architecture.md");
let text = readFileSync(target, "utf8");
for (const name of ["core", "webview", "extension"]) {
  const begin = `<!-- diagram:${name} -->`;
  const end = `<!-- /diagram:${name} -->`;
  const from = text.indexOf(begin);
  const to = text.indexOf(end);
  if (from === -1 || to === -1) {
    console.error(`markers for ${name} missing in docs/architecture.md`);
    process.exit(1);
  }
  const block = `${begin}\n\n\`\`\`mermaid\n${moduleDiagram(name)}\n\`\`\`\n\n`;
  text = text.slice(0, from) + block + text.slice(to);
  console.log(`regenerated diagram: ${name}`);
}
writeFileSync(target, text);
console.log(`wrote ${relative(root, target)}`);
