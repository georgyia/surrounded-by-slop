import { describe, expect, it } from "vitest";
import type { FileInput } from "./adapter.js";
import { syntheticProject } from "./bench/synthetic.js";
import { contentHash, createIncrementalAnalyzer } from "./incremental.js";
import { validateGraph } from "./ir/validate.js";
import { stableStringify } from "./stable-json.js";
import { analyzeTypeScriptProject } from "./typescript/adapter.js";

function serialized(result: { graph: unknown; diagnostics: unknown }): string {
  return stableStringify({ graph: result.graph, diagnostics: result.diagnostics }, 2);
}

function edit(files: FileInput[], path: string, mutate: (text: string) => string): FileInput[] {
  return files.map((file) => (file.path === path ? { ...file, text: mutate(file.text) } : file));
}

describe("contentHash", () => {
  it("is deterministic and sensitive to any content change", () => {
    expect(contentHash("const a = 1;")).toBe(contentHash("const a = 1;"));
    expect(contentHash("const a = 1;")).not.toBe(contentHash("const a = 2;"));
    expect(contentHash("ab")).not.toBe(contentHash("ba"));
    expect(contentHash("")).not.toBe(contentHash(" "));
  });
});

describe("createIncrementalAnalyzer", () => {
  const project = syntheticProject(30);

  it("serves an unchanged project from cache, identically", () => {
    const analyzer = createIncrementalAnalyzer();
    const first = analyzer.analyze(project);
    expect(analyzer.lastPass).toBe("cold");
    const second = analyzer.analyze(project.map((file) => ({ ...file })));
    expect(analyzer.lastPass).toBe("cached");
    expect(second).toBe(first); // the very same result — zero work
  });

  it("a 1-file edit re-links to exactly the cold result", () => {
    const analyzer = createIncrementalAnalyzer();
    analyzer.analyze(project);
    const edited = edit(project, "feature5/mod5.ts", (text) =>
      text.replace("total = service.step(at);", "total = service.step(at) + 1;"),
    );
    const incremental = analyzer.analyze(edited);
    expect(analyzer.lastPass).toBe("partial");
    expect(validateGraph(incremental.graph)).toEqual([]);

    const cold = analyzeTypeScriptProject(edited);
    expect(serialized(incremental)).toBe(serialized(cold));
  });

  it("a dependency edit re-analyzes importers too (removed export drops their edges)", () => {
    const analyzer = createIncrementalAnalyzer();
    analyzer.analyze(project);
    // mod6 imports work5 from mod5; renaming work5 must update mod6's edges.
    const edited = edit(project, "feature5/mod5.ts", (text) =>
      text.replaceAll("work5", "work5Renamed"),
    );
    const editedDependents = edit(edited, "feature6/mod6.ts", (text) =>
      text.replaceAll("work5", "work5Renamed"),
    );
    const incremental = analyzer.analyze(editedDependents);
    expect(analyzer.lastPass).toBe("partial");
    expect(validateGraph(incremental.graph)).toEqual([]);
    expect(serialized(incremental)).toBe(serialized(analyzeTypeScriptProject(editedDependents)));
  });

  it("a changed file set forces a cold pass (resolution may shift)", () => {
    const analyzer = createIncrementalAnalyzer();
    analyzer.analyze(project);
    const withExtra = [...project, { path: "extra.ts", text: "export const extra = 1;\n" }];
    analyzer.analyze(withExtra);
    expect(analyzer.lastPass).toBe("cold");
  });

  it("changed adapter options force a cold pass", () => {
    const analyzer = createIncrementalAnalyzer();
    analyzer.analyze(project);
    analyzer.analyze(project, { adapterOptions: { compilerOptions: { strict: false } } });
    expect(analyzer.lastPass).toBe("cold");
  });

  it("a 1-file edit in a large project is ≥ 10× faster than cold", () => {
    const large = syntheticProject(500);
    const analyzer = createIncrementalAnalyzer();

    const coldStart = performance.now();
    analyzer.analyze(large);
    const coldMs = performance.now() - coldStart;

    const edited = edit(
      large,
      "feature3/mod3.ts",
      (text) => `${text}\nexport const touched = 1;\n`,
    );
    const warmStart = performance.now();
    analyzer.analyze(edited);
    const warmMs = performance.now() - warmStart;

    expect(analyzer.lastPass).toBe("partial");
    expect(coldMs / Math.max(warmMs, 0.001)).toBeGreaterThanOrEqual(10);
  });
});
