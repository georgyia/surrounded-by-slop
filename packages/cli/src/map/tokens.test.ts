import { describe, expect, it } from "vitest";
import { estimateTokens } from "./tokens.js";

describe("estimateTokens", () => {
  it("is zero for the empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("grows monotonically with length", () => {
    expect(estimateTokens("a".repeat(100))).toBeLessThan(estimateTokens("a".repeat(200)));
  });

  it("estimates code in a sane range (≈ 3–4 chars per token)", () => {
    const sample = "export function place(order: Order): string { return order.id; }";
    const estimate = estimateTokens(sample);
    expect(estimate).toBeGreaterThan(sample.length / 5);
    expect(estimate).toBeLessThan(sample.length / 2);
  });
});
