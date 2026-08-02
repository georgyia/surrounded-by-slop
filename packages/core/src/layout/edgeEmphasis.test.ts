import { describe, expect, it } from "vitest";
import type { GraphEdge } from "../ir/types.js";
import { edgeEmphasis, edgeWidth } from "./edgeEmphasis.js";

const edge = (props: Partial<GraphEdge>): GraphEdge => ({
  id: "e",
  kind: "imports",
  from: "a",
  to: "b",
  ...props,
});

describe("edgeWidth", () => {
  it("grows with occurrences on a log scale", () => {
    expect(edgeWidth(1)).toBe(1.2);
    expect(edgeWidth(2)).toBe(1.95);
    expect(edgeWidth(4)).toBe(2.7);
  });

  it("clamps so one hub cannot swamp the picture", () => {
    expect(edgeWidth(1000)).toBe(3.5);
    expect(edgeWidth(1_000_000)).toBe(3.5);
  });

  it("treats a missing or nonsensical count as a single occurrence", () => {
    expect(edgeWidth(undefined)).toBe(1.2);
    expect(edgeWidth(0)).toBe(1.2);
    expect(edgeWidth(-5)).toBe(1.2);
  });
});

describe("edgeEmphasis", () => {
  it("weights ordinary edges by how often they occur", () => {
    expect(edgeEmphasis(edge({ kind: "calls", count: 8 }))).toEqual({
      tone: "normal",
      width: 3.45,
      dash: false,
    });
    expect(edgeEmphasis(edge({ kind: "calls" })).width).toBe(1.2);
  });

  it("keeps imports dashed and calls solid", () => {
    expect(edgeEmphasis(edge({ kind: "imports" })).dash).toBe(true);
    expect(edgeEmphasis(edge({ kind: "calls" })).dash).toBe(false);
  });

  it("mutes what does not exist at runtime, whatever its count", () => {
    // A type-only import is erased before the code runs; an inferred edge may
    // not be real at all. Neither should outweigh actual coupling.
    expect(edgeEmphasis(edge({ typeOnly: true, count: 40 }))).toEqual({
      tone: "muted",
      width: 1.2,
      dash: true,
    });
    expect(edgeEmphasis(edge({ confidence: "low", count: 40 })).tone).toBe("muted");
  });

  it("marks cycles but keeps their weight", () => {
    expect(edgeEmphasis(edge({ inCycle: true, count: 4 }))).toEqual({
      tone: "cycle",
      width: 2.7,
      dash: true,
    });
  });

  it("treats heritage as its own vocabulary, not a weighted edge", () => {
    expect(edgeEmphasis(edge({ kind: "extends", count: 9 }))).toEqual({
      tone: "heritage",
      width: 1.2,
      dash: false,
    });
    expect(edgeEmphasis(edge({ kind: "implements" })).dash).toBe(true);
  });

  it("prefers muting over cycle marking for a type-only cycle", () => {
    // A cycle that exists only in the type system is not a runtime cycle.
    expect(edgeEmphasis(edge({ inCycle: true, typeOnly: true })).tone).toBe("muted");
  });
});
