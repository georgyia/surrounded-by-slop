import { describe, expect, it } from "vitest";
import { stableStringify } from "./index.js";

describe("stableStringify", () => {
  it("sorts object keys lexicographically", () => {
    expect(stableStringify({ b: 1, a: 2, c: 3 })).toBe('{"a":2,"b":1,"c":3}');
  });

  it("sorts keys in nested objects and inside arrays", () => {
    const value = { z: { b: 1, a: 2 }, list: [{ y: 0, x: 1 }] };
    expect(stableStringify(value)).toBe('{"list":[{"x":1,"y":0}],"z":{"a":2,"b":1}}');
  });

  it("preserves array order", () => {
    expect(stableStringify([3, 1, 2])).toBe("[3,1,2]");
  });

  it("is independent of key insertion order", () => {
    const first = stableStringify({ a: 1, b: { d: 4, c: 3 } });
    const second = stableStringify({ b: { c: 3, d: 4 }, a: 1 });
    expect(first).toBe(second);
  });

  it("handles primitives like JSON.stringify", () => {
    expect(stableStringify(null)).toBe("null");
    expect(stableStringify(42)).toBe("42");
    expect(stableStringify("hi")).toBe('"hi"');
    expect(stableStringify(true)).toBe("true");
    expect(stableStringify(undefined)).toBeUndefined();
  });

  it("drops undefined object entries and nulls them in arrays", () => {
    expect(stableStringify({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(stableStringify([undefined, 1])).toBe("[null,1]");
  });

  it("honors toJSON", () => {
    const date = new Date("2026-01-01T00:00:00.000Z");
    expect(stableStringify({ when: date })).toBe(JSON.stringify({ when: date }));
  });

  it("supports indentation", () => {
    expect(stableStringify({ b: 1, a: 2 }, 2)).toBe('{\n  "a": 2,\n  "b": 1\n}');
  });

  it("throws on circular references", () => {
    const value: { self?: unknown } = {};
    value.self = value;
    expect(() => stableStringify(value)).toThrow(TypeError);
  });

  it("allows repeated (non-circular) references to the same object", () => {
    const shared = { k: 1 };
    expect(stableStringify({ a: shared, b: shared })).toBe('{"a":{"k":1},"b":{"k":1}}');
  });

  it("round-trips through JSON.parse", () => {
    const value = { b: [1, { z: true, a: null }], a: "x" };
    expect(JSON.parse(stableStringify(value))).toEqual(value);
  });
});
