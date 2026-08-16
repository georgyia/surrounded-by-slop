import { describe, expect, it } from "vitest";
import {
  countToolCalls,
  mean,
  readAnswer,
  readUsage,
  scoreAnswer,
  spread,
  summarize,
} from "./score.mjs";

/**
 * The expensive half of the eval harness drives a real agent; this half is
 * pure, so it is tested here on canned transcripts and never needs an API key.
 */

const question = {
  id: "where-charge",
  family: "where-defined",
  expect: { symbols: ["charge"], files: ["src/payments.ts"] },
};

describe("scoreAnswer", () => {
  it("accepts an answer that names the gold symbol and file", () => {
    const result = scoreAnswer(question, "It lives in src/payments.ts as charge().");
    expect(result.correct).toBe(true);
    expect(result.recall).toBe(1);
    expect(result.missingSymbols).toEqual([]);
  });

  it("accepts a bare basename, which is how agents actually answer", () => {
    expect(scoreAnswer(question, "charge() in payments.ts").correct).toBe(true);
  });

  it("accepts Windows-style separators in a path", () => {
    expect(scoreAnswer(question, "charge is in src\\payments.ts").correct).toBe(true);
  });

  it("rejects an answer that waffles without naming the symbol", () => {
    const result = scoreAnswer(question, "The payment logic is in src/payments.ts somewhere.");
    expect(result.correct).toBe(false);
    expect(result.missingSymbols).toEqual(["charge"]);
    expect(result.recall).toBe(0.5);
  });

  it("does not count a substring of a longer identifier", () => {
    // `recharge` and `charges` are different symbols; a scorer that counted
    // them would inflate every score it reports.
    const result = scoreAnswer(question, "See recharge() and charges[] in src/payments.ts");
    expect(result.correct).toBe(false);
    expect(result.foundSymbols).toEqual([]);
  });

  it("counts a symbol at the very start or end of an answer", () => {
    expect(scoreAnswer({ ...question, expect: { symbols: ["charge"] } }, "charge").correct).toBe(
      true,
    );
  });

  it("treats an empty or missing answer as wrong, not as a crash", () => {
    expect(scoreAnswer(question, "").correct).toBe(false);
    expect(scoreAnswer(question, undefined).correct).toBe(false);
  });

  it("honours minSymbols/minFiles for questions with several right answers", () => {
    const loose = {
      id: "callers-money",
      family: "who-calls",
      expect: { symbols: ["money", "add", "format"], minSymbols: 1 },
    };
    expect(scoreAnswer(loose, "money() is called there").correct).toBe(true);
    expect(scoreAnswer(loose, "nothing relevant").correct).toBe(false);
  });

  it("scores a question with no expectations as trivially correct", () => {
    expect(scoreAnswer({ id: "x", family: "y" }, "anything").recall).toBe(1);
  });

  it("is deterministic for the same inputs", () => {
    const once = scoreAnswer(question, "charge() in src/payments.ts");
    const twice = scoreAnswer(question, "charge() in src/payments.ts");
    expect(once).toEqual(twice);
  });
});

describe("readAnswer", () => {
  it("reads the result field of a claude -p json result", () => {
    expect(readAnswer({ type: "result", result: "the answer" })).toBe("the answer");
  });

  it("finds the result entry in a streamed array", () => {
    const transcript = [
      { type: "system", subtype: "init" },
      { type: "assistant", message: { content: [{ type: "text", text: "thinking" }] } },
      { type: "result", result: "final" },
    ];
    expect(readAnswer(transcript)).toBe("final");
  });

  it("falls back to concatenated text blocks", () => {
    const transcript = {
      message: {
        content: [
          { type: "text", text: "first" },
          { type: "tool_use", name: "Read" },
          { type: "text", text: "second" },
        ],
      },
    };
    expect(readAnswer(transcript)).toBe("first\nsecond");
  });

  it("returns an empty string for junk rather than throwing", () => {
    expect(readAnswer(null)).toBe("");
    expect(readAnswer(42)).toBe("");
  });
});

describe("readUsage", () => {
  it("sums input, output and cache tokens", () => {
    const usage = readUsage({
      type: "result",
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 5,
        cache_creation_input_tokens: 2,
      },
    });
    expect(usage.totalTokens).toBe(127);
    expect(usage.inputTokens).toBe(100);
  });

  it("reports undefined rather than zero when nothing was measured", () => {
    // An unmeasured cost must never become a claim of "0 tokens".
    expect(readUsage({ type: "result" }).totalTokens).toBeUndefined();
    expect(readUsage(null).totalTokens).toBeUndefined();
  });

  it("counts tool calls anywhere in the transcript", () => {
    const transcript = [
      { type: "assistant", message: { content: [{ type: "tool_use", name: "Grep" }] } },
      { type: "assistant", message: { content: [{ type: "tool_use", name: "Read" }] } },
      { type: "result", result: "done", usage: { input_tokens: 1, output_tokens: 1 } },
    ];
    expect(readUsage(transcript).toolCalls).toBe(2);
  });
});

describe("countToolCalls", () => {
  it("returns zero for a transcript with no tools", () => {
    expect(countToolCalls({ type: "result", result: "answer" })).toBe(0);
  });

  it("survives cycles-free deep nesting", () => {
    expect(countToolCalls({ a: { b: [{ c: { type: "tool_use" } }] } })).toBe(1);
  });
});

describe("mean and spread", () => {
  it("ignores undefined measurements", () => {
    expect(mean([10, undefined, 20])).toBe(15);
  });

  it("returns undefined when nothing is measurable", () => {
    expect(mean([undefined, undefined])).toBeUndefined();
  });

  it("reports zero spread for a single sample", () => {
    expect(spread([5])).toBe(0);
  });

  it("computes the population standard deviation", () => {
    expect(spread([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2);
  });
});

describe("summarize", () => {
  it("aggregates a condition's runs into a table row", () => {
    const summary = summarize([
      { correct: true, recall: 1, totalTokens: 1000, toolCalls: 2, seconds: 3 },
      { correct: false, recall: 0.5, totalTokens: 2000, toolCalls: 6, seconds: 5 },
    ]);
    expect(summary.questions).toBe(2);
    expect(summary.correct).toBe(1);
    expect(summary.accuracy).toBe(0.5);
    expect(summary.recall).toBe(0.75);
    expect(summary.tokens).toBe(1500);
    expect(summary.toolCalls).toBe(4);
  });

  it("keeps tokens undefined when no run measured them", () => {
    const summary = summarize([{ correct: true, recall: 1, toolCalls: 0, seconds: 1 }]);
    expect(summary.tokens).toBeUndefined();
  });
});
