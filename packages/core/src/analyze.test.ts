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
      dataflow: true, // extractDataflow (SBS-072)
    });
    // Must stay in step with ANALYZABLE_EXTENSIONS: a registry lookup that
    // claims not to handle .mjs while the analyzer does is a lie either way.
    expect(typescriptAdapter.extensions).toEqual([
      ".ts",
      ".tsx",
      ".mts",
      ".cts",
      ".js",
      ".jsx",
      ".mjs",
      ".cjs",
    ]);
  });
});

describe("module formats beyond .ts/.js", () => {
  // Found in the field: a Next.js repo whose six .mjs files (postcss.config.mjs
  // and scripts/*.mjs) were silently missing from the workspace map, while
  // every .ts/.tsx showed up. slop.include collects .mts/.cts/.mjs/.cjs, so the
  // adapter has to keep them.
  const project: FileInput[] = [
    { path: "src/lib.ts", text: "export function helper(): number {\n  return 1;\n}" },
    {
      path: "scripts/gen.mjs",
      text: 'import { helper } from "../src/lib.ts";\nexport function gen() {\n  return helper();\n}',
    },
    {
      path: "tools/legacy.cjs",
      text: "function legacy() {\n  return 2;\n}\nmodule.exports = { legacy };",
    },
    { path: "src/typed.mts", text: "export const typed: number = 3;" },
    { path: "src/common.cts", text: "export const common: number = 4;" },
  ];

  it("maps .mjs, .cjs, .mts and .cts modules", () => {
    const result = analyzeTypeScriptProject(project);
    const modules = result.graph.nodes
      .filter((node) => node.kind === "module" && node.external !== true)
      .map((node) => node.qualifiedName)
      .sort();
    expect(modules).toEqual([
      "scripts/gen.mjs",
      "src/common.cts",
      "src/lib.ts",
      "src/typed.mts",
      "tools/legacy.cjs",
    ]);
  });

  it("finds declarations inside a .mjs module", () => {
    const result = analyzeTypeScriptProject(project);
    const names = result.graph.nodes
      .filter((node) => node.span?.file === "scripts/gen.mjs" && node.kind === "function")
      .map((node) => node.name);
    expect(names).toContain("gen");
  });

  it("resolves an import from .mjs into a .ts module", () => {
    const result = analyzeTypeScriptProject(project);
    const imports = result.graph.edges.filter(
      (edge) => edge.kind === "imports" && edge.from.includes("scripts/gen.mjs"),
    );
    expect(imports).toHaveLength(1);
    expect(imports[0]?.to).toContain("src/lib.ts");
  });
});

describe("tsconfig path aliases", () => {
  // The core never reads a tsconfig — the host discovers it and passes the
  // mapping through adapterOptions (#68). What is under test is that the seam
  // actually reaches module resolution.
  const project: FileInput[] = [
    { path: "lib/site.ts", text: "export const SITE = 1;" },
    {
      path: "app/page.tsx",
      text: 'import { SITE } from "@/lib/site";\nexport const url = SITE;',
    },
  ];
  const withAliases = {
    adapterOptions: { compilerOptions: { baseUrl: "/", paths: { "@/*": ["./*"] } } },
  };

  it("resolves an aliased import to the real module", () => {
    const result = analyzeTypeScriptProject(project, withAliases);
    const page = result.graph.nodes.find((node) => node.qualifiedName === "app/page.tsx");
    const site = result.graph.nodes.find((node) => node.qualifiedName === "lib/site.ts");
    expect(page && site).toBeTruthy();
    const edge = result.graph.edges.find(
      (e) => e.kind === "imports" && e.from === page?.id && e.to === site?.id,
    );
    expect(edge).toBeDefined();
    expect(result.graph.nodes.filter((node) => node.external === true)).toEqual([]);
  });

  it("falls back to an external node when no aliases are supplied", () => {
    // This is the #68 bug preserved as a test: the project's own lib/site.ts
    // shows up as if it were an npm package.
    const result = analyzeTypeScriptProject(project);
    const external = result.graph.nodes.filter((node) => node.external === true);
    expect(external.map((node) => node.name)).toEqual(["@/lib"]);
  });

  it("keeps aliases out of the way of relative imports", () => {
    const relative: FileInput[] = [
      { path: "lib/site.ts", text: "export const SITE = 1;" },
      { path: "lib/use.ts", text: 'import { SITE } from "./site.js";\nexport const x = SITE;' },
    ];
    const result = analyzeTypeScriptProject(relative, withAliases);
    expect(result.graph.nodes.filter((node) => node.external === true)).toEqual([]);
  });
});
