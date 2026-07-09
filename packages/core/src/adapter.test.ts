import { describe, expect, it } from "vitest";
import {
  type AnalysisOptions,
  createAdapterRegistry,
  type FileInput,
  type LanguageAdapter,
  OperationCancelledError,
} from "./adapter.js";
import { buildGraph, moduleId } from "./ir/ids.js";
import { validateGraph } from "./ir/validate.js";

/** Minimal adapter proving the contract: one module node per file, nothing guessed. */
const plaintextAdapter: LanguageAdapter = {
  id: "plaintext",
  displayName: "Plain text",
  extensions: [".txt"],
  capabilities: { imports: false, callGraph: false, cfg: false, dataflow: false },
  analyze(files: readonly FileInput[], options?: AnalysisOptions) {
    const nodes = files.map((file, index) => {
      if (options?.cancellation?.cancelled) {
        throw new OperationCancelledError();
      }
      options?.onProgress?.({ phase: "structure", done: index + 1, total: files.length });
      return {
        id: moduleId(file.path),
        kind: "module" as const,
        name: file.path,
        qualifiedName: file.path,
      };
    });
    return { graph: buildGraph(nodes, []), diagnostics: [] };
  },
};

describe("LanguageAdapter contract", () => {
  it("produces a valid canonical graph from source text alone", () => {
    const result = plaintextAdapter.analyze([
      { path: "notes/b.txt", text: "beta" },
      { path: "a.txt", text: "alpha" },
    ]);
    expect(validateGraph(result.graph)).toEqual([]);
    expect(result.graph.nodes.map((n) => n.id)).toEqual(["module:a.txt", "module:notes/b.txt"]);
  });

  it("reports progress and honors cancellation", () => {
    const seen: number[] = [];
    plaintextAdapter.analyze([{ path: "a.txt", text: "" }], {
      onProgress: (p) => seen.push(p.done),
    });
    expect(seen).toEqual([1]);

    expect(() =>
      plaintextAdapter.analyze([{ path: "a.txt", text: "" }], {
        cancellation: { cancelled: true },
      }),
    ).toThrow(OperationCancelledError);
  });
});

describe("createAdapterRegistry", () => {
  it("registers and resolves by id and by path", () => {
    const registry = createAdapterRegistry();
    registry.register(plaintextAdapter);
    expect(registry.byId("plaintext")).toBe(plaintextAdapter);
    expect(registry.forPath("docs/readme.TXT")).toBe(plaintextAdapter);
    expect(registry.all()).toEqual([plaintextAdapter]);
  });

  it("returns nothing for unknown extensions instead of throwing", () => {
    const registry = createAdapterRegistry();
    registry.register(plaintextAdapter);
    expect(registry.forPath("main.rs")).toBeUndefined();
    expect(registry.forPath("Makefile")).toBeUndefined();
  });

  it("rejects double registration", () => {
    const registry = createAdapterRegistry();
    registry.register(plaintextAdapter);
    expect(() => registry.register(plaintextAdapter)).toThrow(/already registered/);
  });
});
