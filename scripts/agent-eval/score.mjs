/**
 * Scoring for the agent eval harness (SBS-119).
 *
 * Deliberately pure and free of any API: given a question's expectations and
 * an agent transcript, it produces the same numbers every time. That is what
 * lets the scorer be unit-tested in CI on canned transcripts while the
 * expensive half — actually driving an agent — stays a maintainer-run tool.
 *
 * Correctness is gold-answer recall, in the spirit of gold-context scoring:
 * did the answer name the symbols and files that the graph proves are
 * involved? It is deliberately generous about prose and strict about
 * identifiers — an answer that mentions the right function in any phrasing
 * counts, one that waffles without naming it does not.
 */

/** Word-boundary match, so `format` does not match `formatter` or `reformat`. */
function mentionsSymbol(answer, symbol) {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_$])${escaped}([^A-Za-z0-9_$]|$)`).test(answer);
}

/**
 * A file counts as mentioned by its path or by its basename: agents routinely
 * answer "in money.ts" when the question named one repo, and that is a correct
 * answer, not a near miss.
 */
function mentionsFile(answer, file) {
  const normalized = answer.replaceAll("\\", "/");
  if (normalized.includes(file)) {
    return true;
  }
  const base = file.split("/").pop();
  return base !== undefined && base !== "" && normalized.includes(base);
}

/**
 * Score one answer against one question.
 *
 * `expect.symbols` / `expect.files` are the gold set. By default every entry
 * must appear; `minSymbols` / `minFiles` relax that to "at least n of them",
 * for questions where several answers are legitimately correct.
 */
export function scoreAnswer(question, answer) {
  const text = answer ?? "";
  const expect = question.expect ?? {};
  const symbols = expect.symbols ?? [];
  const files = expect.files ?? [];

  const foundSymbols = symbols.filter((symbol) => mentionsSymbol(text, symbol));
  const foundFiles = files.filter((file) => mentionsFile(text, file));

  const neededSymbols = expect.minSymbols ?? symbols.length;
  const neededFiles = expect.minFiles ?? files.length;
  const correct = foundSymbols.length >= neededSymbols && foundFiles.length >= neededFiles;

  const total = symbols.length + files.length;
  const found = foundSymbols.length + foundFiles.length;
  return {
    id: question.id,
    family: question.family,
    correct,
    recall: total === 0 ? 1 : found / total,
    foundSymbols,
    foundFiles,
    missingSymbols: symbols.filter((symbol) => !foundSymbols.includes(symbol)),
    missingFiles: files.filter((file) => !foundFiles.includes(file)),
  };
}

/**
 * Pull usage out of a `claude -p --output-format json` result.
 *
 * Shapes differ between versions and between a single result object and a
 * streamed array, so this reads defensively and reports `undefined` rather
 * than guessing a number — an unmeasured cost must never become a claim.
 */
export function readUsage(transcript) {
  const record = Array.isArray(transcript)
    ? (transcript.find((entry) => entry?.type === "result") ?? transcript.at(-1))
    : transcript;
  if (record === null || typeof record !== "object") {
    return {
      inputTokens: undefined,
      outputTokens: undefined,
      totalTokens: undefined,
      toolCalls: 0,
    };
  }
  const usage = record.usage ?? record.result?.usage ?? {};
  const input = numberOrUndefined(usage.input_tokens ?? usage.inputTokens);
  const output = numberOrUndefined(usage.output_tokens ?? usage.outputTokens);
  const cacheRead = numberOrUndefined(usage.cache_read_input_tokens) ?? 0;
  const cacheWrite = numberOrUndefined(usage.cache_creation_input_tokens) ?? 0;
  const total =
    input === undefined && output === undefined
      ? undefined
      : (input ?? 0) + (output ?? 0) + cacheRead + cacheWrite;
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: total,
    toolCalls: countToolCalls(transcript),
  };
}

function numberOrUndefined(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Count `tool_use` blocks across a transcript, whatever nesting it arrives in. */
export function countToolCalls(transcript) {
  let count = 0;
  const walk = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item);
      }
      return;
    }
    if (value === null || typeof value !== "object") {
      return;
    }
    if (value.type === "tool_use") {
      count += 1;
    }
    for (const item of Object.values(value)) {
      walk(item);
    }
  };
  walk(transcript);
  return count;
}

/** Extract the final answer text from a transcript. */
export function readAnswer(transcript) {
  const record = Array.isArray(transcript)
    ? (transcript.find((entry) => entry?.type === "result") ?? transcript.at(-1))
    : transcript;
  if (typeof record === "string") {
    return record;
  }
  if (record === null || typeof record !== "object") {
    return "";
  }
  if (typeof record.result === "string") {
    return record.result;
  }
  const content = record.message?.content ?? record.content;
  if (Array.isArray(content)) {
    return content
      .filter((block) => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("\n");
  }
  return typeof content === "string" ? content : "";
}

/** Mean of the defined values, or undefined when nothing was measured. */
export function mean(values) {
  const defined = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (defined.length === 0) {
    return undefined;
  }
  return defined.reduce((sum, value) => sum + value, 0) / defined.length;
}

/** Population standard deviation, for the ± in the results table. */
export function spread(values) {
  const defined = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (defined.length < 2) {
    return 0;
  }
  const average = mean(defined) ?? 0;
  const variance = defined.reduce((sum, value) => sum + (value - average) ** 2, 0) / defined.length;
  return Math.sqrt(variance);
}

/** Aggregate per-condition results into the row a results table shows. */
export function summarize(runs) {
  const accuracy = runs.map((run) => (run.correct ? 1 : 0));
  return {
    questions: runs.length,
    correct: accuracy.reduce((sum, value) => sum + value, 0),
    accuracy: mean(accuracy) ?? 0,
    recall: mean(runs.map((run) => run.recall)) ?? 0,
    tokens: mean(runs.map((run) => run.totalTokens)),
    tokensSpread: spread(runs.map((run) => run.totalTokens)),
    toolCalls: mean(runs.map((run) => run.toolCalls)),
    seconds: mean(runs.map((run) => run.seconds)),
  };
}
