import { describe, expect, it } from "vitest";
import { intOption, optionValue, optionValues, parseArgs, UsageError } from "./args.js";

const spec = { booleans: ["json", "verbose"] };

describe("parseArgs", () => {
  it("collects positionals, boolean flags, and value options", () => {
    const parsed = parseArgs(["src", "--json", "--format", "mermaid"], spec);
    expect(parsed.positionals).toEqual(["src"]);
    expect(parsed.flags.has("json")).toBe(true);
    expect(optionValue(parsed, "format")).toBe("mermaid");
  });

  it("supports --key=value", () => {
    const parsed = parseArgs(["--budget=500"], spec);
    expect(optionValue(parsed, "budget")).toBe("500");
  });

  it("collects repeatable options in order", () => {
    const parsed = parseArgs(["--include", "a/**", "--include", "b/**"], spec);
    expect(optionValues(parsed, "include")).toEqual(["a/**", "b/**"]);
  });

  it("treats a value-less non-boolean flag as a present flag", () => {
    const parsed = parseArgs(["--format", "--json"], spec);
    expect(parsed.flags.has("format")).toBe(true);
    expect(parsed.flags.has("json")).toBe(true);
  });

  it("does not swallow the next flag as a value", () => {
    const parsed = parseArgs(["--include", "--json"], spec);
    expect(optionValues(parsed, "include")).toEqual([]);
    expect(parsed.flags.has("json")).toBe(true);
  });
});

describe("intOption", () => {
  it("parses integers and falls back when absent", () => {
    expect(intOption(parseArgs(["--budget", "42"], spec), "budget", 10)).toBe(42);
    expect(intOption(parseArgs([], spec), "budget", 10)).toBe(10);
  });

  it("throws a UsageError on non-integers", () => {
    expect(() => intOption(parseArgs(["--budget", "lots"], spec), "budget", 10)).toThrow(
      UsageError,
    );
  });
});
