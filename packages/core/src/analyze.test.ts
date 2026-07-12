import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AnalysisProgress, FileInput } from "./adapter.js";
import { OperationCancelledError } from "./adapter.js";
import { validateGraph } from "./ir/validate.js";
import { stableStringify } from "./stable-json.js";
import { analyzeTypeScriptProject, typescriptAdapter } from "./typescript/adapter.js";

const files: FileInput[] = [
  { path: "src/a.ts", text: 'import { b } from "./b";\nexport const a = b;' },
  { path: "src/b.ts", text: "export const b = 1;\nexport function f(): void {}" },
  { path: "src/c.ts", text: 'import { f } from "./b";\nexport function g(): void {\n  f();\n}' },
];

describe("project analysis", () => {
  it("is independent of input file order", () => {
    const forward = analyzeTypeScriptProject(files);
    const reversed = analyzeTypeScriptProject([...files].reverse());
    expect(stableStringify(reversed, 2)).toBe(stableStringify(forward, 2));
  });

  it("reports per-phase progress over all files", () => {
    const seen: AnalysisProgress[] = [];
    analyzeTypeScriptProject(files, { onProgress: (progress) => seen.push(progress) });
    const phases = [...new Set(seen.map((p) => p.phase))];
    expect(phases).toEqual(["structure", "imports", "calls"]);
    for (const phase of phases) {
      const steps = seen.filter((p) => p.phase === phase);
      expect(steps.map((s) => s.done)).toEqual([1, 2, 3]);
      expect(steps.every((s) => s.total === 3)).toBe(true);
    }
  });

  it("stops at the next file boundary once cancelled", () => {
    let cancelled = false;
    const progressed: AnalysisProgress[] = [];
    expect(() =>
      analyzeTypeScriptProject(files, {
        cancellation: {
          get cancelled() {
            return cancelled;
          },
        },
        onProgress: (progress) => {
          progressed.push(progress);
          cancelled = true; // cancel after the first file of the first phase
        },
      }),
    ).toThrow(OperationCancelledError);
    expect(progressed).toHaveLength(1);
  });

  it("analyzes this package's own source cleanly (dogfood)", () => {
    const sourceDir = fileURLToPath(new URL("../src", import.meta.url));
    const inputs: FileInput[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
          inputs.push({
            path: path.relative(sourceDir, full).replaceAll(path.sep, "/"),
            text: fs.readFileSync(full, "utf8"),
          });
        }
      }
    };
    walk(sourceDir);

    const result = analyzeTypeScriptProject(inputs);
    expect(validateGraph(result.graph)).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    // Sanity: the analyzer sees itself.
    const ids = result.graph.nodes.map((node) => node.id);
    expect(ids).toContain("module:typescript/adapter.ts");
    expect(ids).toContain("module:external:typescript");
    expect(
      result.graph.edges.some(
        (edge) =>
          edge.kind === "calls" &&
          edge.from === "function:typescript/adapter.ts#analyzeTypeScriptProject",
      ),
    ).toBe(true);
  });

  it("exposes honest adapter capabilities", () => {
    expect(typescriptAdapter.capabilities).toEqual({
      imports: true,
      callGraph: "typed",
      cfg: true, // extractControlFlow (SBS-070)
      dataflow: false,
    });
    expect(typescriptAdapter.extensions).toEqual([".ts", ".tsx", ".js", ".jsx"]);
  });
});
