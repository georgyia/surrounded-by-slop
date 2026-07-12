import { describe, expect, it } from "vitest";
import {
  EMPTY_FILTER,
  type FilterableNode,
  type FilterState,
  fuzzyMatch,
  isFiltering,
  matchingIds,
  nodePasses,
  topSegment,
} from "./search.js";

const nodes: FilterableNode[] = [
  { id: "f1", label: "placeOrder", kind: "function", path: "src/orders.ts" },
  { id: "c1", label: "OrderService", kind: "class", path: "src/orders.ts" },
  { id: "m1", label: "money.ts", kind: "module", path: "src/util/money.ts" },
  { id: "f2", label: "charge", kind: "function", path: "src/payments.ts" },
];

function filter(overrides: Partial<FilterState>): FilterState {
  return { ...EMPTY_FILTER, ...overrides };
}

describe("fuzzyMatch", () => {
  it("matches an in-order subsequence, case-insensitively", () => {
    expect(fuzzyMatch("placeOrder", "por")).toBe(true);
    expect(fuzzyMatch("placeOrder", "PLACE")).toBe(true);
    expect(fuzzyMatch("placeOrder", "xyz")).toBe(false);
    expect(fuzzyMatch("placeOrder", "rdlp")).toBe(false); // out of order
  });

  it("treats an empty query as a match", () => {
    expect(fuzzyMatch("anything", "")).toBe(true);
  });
});

describe("topSegment", () => {
  it("takes the leading path segment", () => {
    expect(topSegment("src/util/money.ts")).toBe("src");
    expect(topSegment("index.ts")).toBe("index.ts");
  });
});

describe("isFiltering", () => {
  it("is false only when nothing is set", () => {
    expect(isFiltering(EMPTY_FILTER)).toBe(false);
    expect(isFiltering(filter({ query: "a" }))).toBe(true);
    expect(isFiltering(filter({ disabledKinds: new Set(["class"]) }))).toBe(true);
    expect(isFiltering(filter({ disabledPaths: new Set(["src"]) }))).toBe(true);
  });
});

describe("nodePasses / matchingIds", () => {
  it("matches the query against label or path", () => {
    expect(matchingIds(nodes, filter({ query: "order" }))).toEqual(["f1", "c1"]);
    // 'money' only appears in a path — still found.
    expect(matchingIds(nodes, filter({ query: "money" }))).toEqual(["m1"]);
  });

  it("hides disabled kinds", () => {
    expect(
      nodePasses(nodes[1] as FilterableNode, filter({ disabledKinds: new Set(["class"]) })),
    ).toBe(false);
  });

  it("hides disabled top-level paths", () => {
    const util = { id: "x", label: "add", kind: "function", path: "src/util/money.ts" } as const;
    expect(nodePasses(util, filter({ disabledPaths: new Set(["src"]) }))).toBe(false);
  });

  it("composes query and chip filters", () => {
    const state = filter({ query: "order", disabledKinds: new Set(["class"]) });
    // 'OrderService' matches the query but its kind is off → only the function.
    expect(matchingIds(nodes, state)).toEqual(["f1"]);
  });
});
