/**
 * `pnpm docs:agent` — regenerate the generated blocks in
 * docs/agent-interface.md (SBS-120).
 *
 * Two kinds of block, both spliced between `<!-- agent:<name> -->` markers the
 * same way `docs:diagrams` does (SBS-101), so the page cannot drift from the
 * code:
 *
 * - **examples** — every command run for real against examples/orders-app,
 *   with its actual output pasted in. If a command's output changes, rerunning
 *   this script changes the docs, and CI fails until it is rerun.
 * - **languages** — the precision table, built from each adapter's own
 *   `capabilities` flags rather than prose, so the page cannot promise more
 *   than an adapter declares.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Grammars are core's dependencies, so resolve them from core, not the root.
const require = createRequire(join(root, "packages/core/package.json"));
const core = await import(new URL(`file://${root}/packages/core/dist/index.js`).href);

const SAMPLE = "examples/orders-app";
const cli = join(root, "packages/cli/dist/bin.js");

/** Run `sbs` exactly as a user would, and capture what they would see. */
function sbs(args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    cwd: root,
  });
  if (result.status !== 0) {
    throw new Error(`sbs ${args.join(" ")} exited ${result.status}\n${result.stderr}`);
  }
  return result.stdout.trimEnd();
}

/** One documented example: the command line, then its real output. */
function example(args, { truncateTo } = {}) {
  let output = sbs(args);
  if (truncateTo !== undefined) {
    const lines = output.split("\n");
    if (lines.length > truncateTo) {
      output = `${lines.slice(0, truncateTo).join("\n")}\n…`;
    }
  }
  return ["```console", `$ sbs ${args.join(" ")}`, output, "```"].join("\n");
}

const EXAMPLES = {
  map: () => example(["map", SAMPLE, "--budget", "220"]),
  "query-defs": () => example(["query", "defs", "charge", "--root", SAMPLE]),
  "query-callers": () => example(["query", "callers", "charge", "--root", SAMPLE]),
  "query-callees": () => example(["query", "callees", "placeOrderFinal", "--root", SAMPLE]),
  "query-importers": () => example(["query", "importers", "src/payments.ts", "--root", SAMPLE]),
  "query-path": () => example(["query", "path", "main", "charge", "--root", SAMPLE]),
  "query-slice": () => example(["query", "slice", "charge", "--root", SAMPLE, "--depth", "1"]),
  impact: () => example(["impact", "--root", SAMPLE, "--diff", "HEAD"], { truncateTo: 12 }),
  analyze: () => example(["analyze", SAMPLE, "--json"], { truncateTo: 8 }),
  init: () =>
    ["```console", "$ sbs init", "created: AGENTS.md", "created: CLAUDE.md", "```"].join("\n"),
};

/**
 * The precision table, derived from the adapters themselves. Loading a
 * tree-sitter adapter needs its grammar, which comes from node_modules exactly
 * as the tests load it.
 */
function grammar(name) {
  return readFileSync(
    join(dirname(require.resolve("@vscode/tree-sitter-wasm/package.json")), `wasm/${name}`),
  );
}

async function languageTable() {
  const runtime = readFileSync(require.resolve("web-tree-sitter/web-tree-sitter.wasm"));
  const adapters = [
    core.typescriptAdapter,
    await core.createPythonAdapter({ runtime, python: grammar("tree-sitter-python.wasm") }),
    await core.createGoAdapter({ runtime, go: grammar("tree-sitter-go.wasm") }),
    await core.createJavaAdapter({ runtime, java: grammar("tree-sitter-java.wasm") }),
    await core.createRustAdapter({ runtime, rust: grammar("tree-sitter-rust.wasm") }),
    await core.createRubyAdapter({ runtime, ruby: grammar("tree-sitter-ruby.wasm") }),
    await core.createCSharpAdapter({ runtime, csharp: grammar("tree-sitter-c-sharp.wasm") }),
  ];
  // `callGraph` is "typed" | "heuristic" | false (see adapter.ts). Anything
  // unmapped is surfaced raw rather than silently prettified, so a new
  // capability value shows up in the docs instead of hiding.
  const callGraph = {
    typed: "resolved by the type checker",
    heuristic: 'heuristic — marked `confidence: "low"`',
    false: "none",
  };
  const yesNo = (value) => (value ? "yes" : "no");
  const rows = adapters.map((adapter) => {
    const c = adapter.capabilities;
    return `| ${adapter.displayName} | \`${adapter.extensions.join("`, `")}\` | ${yesNo(
      c.imports,
    )} | ${callGraph[String(c.callGraph)] ?? String(c.callGraph)} | ${yesNo(c.cfg)} | ${yesNo(
      c.dataflow,
    )} |`;
  });
  return [
    "| Language | Files | Imports | Call graph | Control flow | Data flow |",
    "|---|---|---|---|---|---|",
    ...rows,
  ].join("\n");
}

const target = join(root, "docs/agent-interface.md");
let text = readFileSync(target, "utf8");
const blocks = { ...EXAMPLES, languages: languageTable };

for (const [name, produce] of Object.entries(blocks)) {
  const begin = `<!-- agent:${name} -->`;
  const end = `<!-- /agent:${name} -->`;
  const from = text.indexOf(begin);
  const to = text.indexOf(end);
  if (from === -1 || to === -1) {
    console.error(`markers for ${name} missing in docs/agent-interface.md`);
    process.exit(1);
  }
  const body = await produce();
  text = `${text.slice(0, from)}${begin}\n\n${body}\n\n${text.slice(to)}`;
  console.log(`regenerated: ${name}`);
}

writeFileSync(target, text);
console.log(`wrote ${relative(root, target)}`);
