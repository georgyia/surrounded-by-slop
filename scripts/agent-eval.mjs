/**
 * `pnpm bench:agent` — the agent eval harness (SBS-119).
 *
 * Every tool in this space advertises spectacular numbers. Rule 2 says tested
 * means tested, and that has to apply to a marketing claim exactly as it
 * applies to code: if the README is going to say "saves tokens", this script
 * must be able to prove it on this machine, today.
 *
 * Two conditions, same questions, same model, temperature 0:
 *   A  plain repo access — the agent greps and reads.
 *   B  the same, plus the `sbs` MCP server and the AGENTS.md bootstrap block.
 *
 * Per question it records correctness against a gold set, total tokens, tool
 * calls and wall-clock; it prints a comparison table, writes
 * `bench/agent-results.local.json`, and stops there. It is deliberately **not**
 * CI-gated: it spends real API tokens, so it is a maintainer tool run
 * deliberately before making or refreshing a claim.
 *
 * Usage:
 *   node scripts/agent-eval.mjs --verify              # gold set only, no API
 *   node scripts/agent-eval.mjs [--runs 3] [--questions <substring>]
 *                               [--model <id>] [--dry-run]
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readAnswer, readUsage, scoreAnswer, spread, summarize } from "./agent-eval/score.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const core = await import(new URL(`file://${root}/packages/core/dist/index.js`).href);
const { discoverFiles } = await import(
  new URL(`file://${root}/packages/host/dist/discovery.js`).href
);

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? fallback : argv[at + 1];
};

const questionSet = JSON.parse(readFileSync(join(root, "bench/agent-questions.json"), "utf8"));
const filter = value("questions");
const questions = questionSet.questions.filter(
  (question) =>
    filter === undefined || question.id.includes(filter) || question.family.includes(filter),
);

if (questions.length === 0) {
  console.error(`no questions match --questions ${filter}`);
  process.exit(1);
}

/** Analyze a repo once; both verification and reporting read the same graph. */
const graphCache = new Map();
function graphFor(repo) {
  const cached = graphCache.get(repo);
  if (cached !== undefined) {
    return cached;
  }
  const files = discoverFiles(join(root, repo));
  const { graph } = core.analyzeTypeScriptProject(files);
  graphCache.set(repo, graph);
  return graph;
}

/**
 * Gold-set integrity: every expected symbol and file must exist in the real
 * graph. Cheap, API-free, and wired into CI — so the gold set cannot rot as
 * the fixtures change underneath it.
 */
function verify() {
  const problems = [];
  for (const question of questions) {
    const graph = graphFor(question.repo);
    const symbols = new Set(graph.nodes.map((node) => node.name));
    const files = new Set(graph.nodes.map((node) => node.span?.file).filter(Boolean));
    for (const symbol of question.expect?.symbols ?? []) {
      if (!symbols.has(symbol)) {
        problems.push(`${question.id}: no symbol "${symbol}" in ${question.repo}`);
      }
    }
    for (const file of question.expect?.files ?? []) {
      if (!files.has(file)) {
        problems.push(`${question.id}: no file "${file}" in ${question.repo}`);
      }
    }
  }
  if (problems.length > 0) {
    console.error(`gold set is stale:\n${problems.map((line) => `  ${line}`).join("\n")}`);
    process.exit(1);
  }
  console.log(
    `gold set verified: ${questions.length} questions, every answer present in the graph`,
  );
}

if (flag("verify")) {
  verify();
  process.exit(0);
}

// Any real run verifies first: reporting numbers against a rotted gold set
// would be worse than reporting nothing.
verify();

const claude = "claude";
const probe = spawnSync(claude, ["--version"], { encoding: "utf8" });
if (probe.error !== undefined || probe.status !== 0) {
  console.error(
    [
      "the `claude` CLI is required to run the agent eval and was not found.",
      "",
      "Install it (https://claude.com/claude-code), or run the API-free half:",
      "  node scripts/agent-eval.mjs --verify",
    ].join("\n"),
  );
  process.exit(1);
}

const runs = Number.parseInt(value("runs", "3"), 10);
const model = value("model", "claude-sonnet-5");
const dryRun = flag("dry-run");

/** One agent invocation, in one condition, timed. */
function ask(question, condition) {
  const cwd = join(root, question.repo);
  const args = [
    "-p",
    question.prompt,
    "--output-format",
    "json",
    "--model",
    model,
    // Condition A must not reach the graph even if the machine has the MCP
    // server configured globally; condition B gets exactly one extra tool.
    ...(condition === "B"
      ? ["--mcp-config", join(root, "bench/agent-mcp.json"), "--allowedTools", "mcp__slop"]
      : ["--strict-mcp-config"]),
  ];
  if (dryRun) {
    return { transcript: { type: "result", result: "" }, seconds: 0, skipped: true };
  }
  const startedAt = Date.now();
  const result = spawnSync(claude, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const seconds = (Date.now() - startedAt) / 1000;
  if (result.status !== 0) {
    throw new Error(
      `claude exited ${result.status} for ${question.id}/${condition}\n${result.stderr}`,
    );
  }
  let transcript;
  try {
    transcript = JSON.parse(result.stdout);
  } catch {
    transcript = result.stdout;
  }
  return { transcript, seconds, skipped: false };
}

function measure(question, condition) {
  const { transcript, seconds, skipped } = ask(question, condition);
  const answer = readAnswer(transcript);
  const usage = readUsage(transcript);
  const score = scoreAnswer(question, answer);
  return { ...score, ...usage, seconds, condition, skipped };
}

const results = { A: [], B: [] };
for (let run = 1; run <= runs; run += 1) {
  for (const question of questions) {
    for (const condition of ["A", "B"]) {
      const measured = measure(question, condition);
      results[condition].push({ ...measured, run });
      console.log(
        `run ${run} · ${condition} · ${question.id}: ${measured.correct ? "correct" : "wrong"}` +
          `${measured.totalTokens === undefined ? "" : ` · ${measured.totalTokens} tokens`}` +
          ` · ${measured.toolCalls} tool calls`,
      );
    }
  }
}

const summary = { A: summarize(results.A), B: summarize(results.B) };
const number = (value, digits = 0) =>
  value === undefined ? "not measured" : value.toFixed(digits);

const table = [
  "| Condition | Accuracy | Gold recall | Tokens (mean ± sd) | Tool calls | Seconds |",
  "|---|---|---|---|---|---|",
  ...["A", "B"].map((condition) => {
    const s = summary[condition];
    const label = condition === "A" ? "A — plain repo" : "B — with `sbs` MCP";
    const tokens =
      s.tokens === undefined
        ? "not measured"
        : `${number(s.tokens)} ± ${number(spread(results[condition].map((r) => r.totalTokens)))}`;
    return `| ${label} | ${(s.accuracy * 100).toFixed(0)}% (${s.correct}/${s.questions}) | ${(
      s.recall * 100
    ).toFixed(0)}% | ${tokens} | ${number(s.toolCalls, 1)} | ${number(s.seconds, 1)} |`;
  }),
].join("\n");

console.log(`\n${table}\n`);

const report = {
  generatedAt: new Date().toISOString(),
  commit: spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", cwd: root }).stdout?.trim(),
  model,
  runs,
  questions: questions.map((question) => question.id),
  summary,
  results,
  table,
};
const out = join(root, "bench/agent-results.local.json");
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(`wrote ${out}`);
console.log(
  "Paste the table into docs/agent-interface.md (methodology section) when refreshing a claim.",
);
