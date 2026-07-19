import { analyzeTypeScriptProject } from "@surrounded-by-slop/core";
import { describe, expect, it } from "vitest";
import { resolveModule, resolveSymbol } from "./resolve.js";

const { graph } = analyzeTypeScriptProject([
  {
    path: "src/a.ts",
    text: "export function shared(): void {}\nexport function only(): void {}",
  },
  {
    path: "src/b.ts",
    text: "export function shared(): void {}",
  },
]);

describe("resolveSymbol", () => {
  it("resolves a unique bare name", () => {
    const res = resolveSymbol(graph, "only");
    expect(res.kind).toBe("resolved");
    expect(res.kind === "resolved" && res.node.name).toBe("only");
  });

  it("reports ambiguity when a name occurs in two files", () => {
    const res = resolveSymbol(graph, "shared");
    expect(res.kind).toBe("ambiguous");
    expect(res.kind === "ambiguous" && res.candidates).toHaveLength(2);
  });

  it("disambiguates with file:name", () => {
    const res = resolveSymbol(graph, "src/b.ts:shared");
    expect(res.kind).toBe("resolved");
    expect(res.kind === "resolved" && res.node.span?.file).toBe("src/b.ts");
  });

  it("suggests near matches for an unknown symbol", () => {
    const res = resolveSymbol(graph, "shar");
    expect(res.kind).toBe("unknown");
    expect(res.kind === "unknown" && res.suggestions.some((n) => n.name === "shared")).toBe(true);
  });

  it("returns no suggestions when nothing is close", () => {
    const res = resolveSymbol(graph, "zzz-nothing");
    expect(res.kind).toBe("unknown");
    expect(res.kind === "unknown" && res.suggestions).toHaveLength(0);
  });
});

describe("resolveModule", () => {
  it("resolves a file path to its module", () => {
    const res = resolveModule(graph, "src/a.ts");
    expect(res.kind).toBe("resolved");
    expect(res.kind === "resolved" && res.node.kind).toBe("module");
  });

  it("suggests modules for an unknown file", () => {
    const res = resolveModule(graph, "src/a");
    expect(res.kind).toBe("unknown");
    expect(
      res.kind === "unknown" && res.suggestions.some((n) => n.qualifiedName === "src/a.ts"),
    ).toBe(true);
  });
});
