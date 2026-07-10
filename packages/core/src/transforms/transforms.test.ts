import { describe, expect, it } from "vitest";
import { validateGraph } from "../ir/validate.js";
import { analyzeTypeScriptProject } from "../typescript/adapter.js";
import {
  collapseToFolders,
  collapseToModules,
  filterGraph,
  reachableFrom,
  sliceAround,
} from "./transforms.js";

/** One realistic graph, produced by the actual analyzer, shared by all cases. */
const { graph } = analyzeTypeScriptProject([
  {
    path: "src/app.ts",
    text: [
      'import { save } from "./store/db";',
      'import { fmt } from "./util";',
      "export function main(): void {",
      "  save(fmt());",
      "}",
    ].join("\n"),
  },
  {
    path: "src/store/db.ts",
    text: ["export function save(value: string): void {", "  const v = value;", "}"].join("\n"),
  },
  {
    path: "src/util.ts",
    text: ["export function fmt(): string {", '  return "";', "}"].join("\n"),
  },
  {
    path: "vendor.ts",
    text: 'import "react";\nexport const marker = 1;',
  },
]);

it("the shared analysis graph is valid", () => {
  expect(validateGraph(graph)).toEqual([]);
});

describe("filterGraph", () => {
  it("filters by kind", () => {
    const onlyModules = filterGraph(graph, { kinds: ["module"] });
    expect(onlyModules.nodes.every((node) => node.kind === "module")).toBe(true);
    expect(onlyModules.edges.every((edge) => edge.kind === "imports")).toBe(true);
  });

  it("filters by include and exclude globs", () => {
    const srcOnly = filterGraph(graph, { include: ["src/**"] });
    expect(srcOnly.nodes.some((node) => node.id === "module:vendor.ts")).toBe(false);
    expect(srcOnly.nodes.some((node) => node.id === "module:src/app.ts")).toBe(true);

    const noStore = filterGraph(graph, { exclude: ["src/store/**"] });
    expect(noStore.nodes.some((node) => node.id === "module:src/store/db.ts")).toBe(false);
    expect(noStore.nodes.some((node) => node.id === "function:src/store/db.ts#save")).toBe(false);
  });

  it("drops edges to removed nodes", () => {
    const result = filterGraph(graph, { exclude: ["src/util.ts"] });
    expect(validateGraph(result)).toEqual([]);
    expect(result.edges.some((edge) => edge.to.includes("util"))).toBe(false);
  });
});

describe("collapseToModules", () => {
  const collapsed = collapseToModules(graph);

  it("keeps only modules, external packages and sinks", () => {
    expect(collapsed.nodes.every((node) => node.kind === "module" || node.external === true)).toBe(
      true,
    );
  });

  it("lifts call edges to module level and drops self-loops", () => {
    expect(
      collapsed.edges.some(
        (edge) =>
          edge.kind === "calls" &&
          edge.from === "module:src/app.ts" &&
          edge.to === "module:src/store/db.ts",
      ),
    ).toBe(true);
    expect(collapsed.edges.every((edge) => edge.from !== edge.to)).toBe(true);
    expect(collapsed.edges.every((edge) => edge.kind !== "contains")).toBe(true);
  });

  it("is idempotent", () => {
    expect(collapseToModules(collapsed)).toEqual(collapsed);
  });
});

describe("collapseToFolders", () => {
  it("groups modules under folder nodes at the given depth", () => {
    const folders = collapseToFolders(graph, 1);
    const ids = folders.nodes.map((node) => node.id);
    expect(ids).toContain("folder:src");
    expect(ids).toContain("module:vendor.ts"); // root files survive
    expect(ids).toContain("module:external:react");
    expect(ids).not.toContain("module:src/app.ts");
    expect(validateGraph(folders)).toEqual([]);
  });

  it("keeps deeper structure at depth 2", () => {
    const folders = collapseToFolders(graph, 2);
    const ids = folders.nodes.map((node) => node.id);
    expect(ids).toContain("folder:src/store");
    expect(ids).toContain("module:src/app.ts"); // only one segment deep — stays a module
  });
});

describe("sliceAround", () => {
  it("returns the neighborhood plus containment ancestors", () => {
    const slice = sliceAround(graph, "function:src/store/db.ts#save", 1);
    const ids = slice.nodes.map((node) => node.id);
    expect(ids).toContain("function:src/store/db.ts#save");
    expect(ids).toContain("function:src/app.ts#main"); // caller within depth 1
    expect(ids).toContain("module:src/store/db.ts"); // ancestor for context
    expect(ids).not.toContain("module:vendor.ts");
    expect(validateGraph(slice)).toEqual([]);
  });

  it("throws for unknown nodes", () => {
    expect(() => sliceAround(graph, "function:ghost.ts#nope")).toThrow(/not in the graph/);
  });
});

describe("reachableFrom", () => {
  it("follows calls and imports forward only", () => {
    const reachable = reachableFrom(graph, "function:src/app.ts#main");
    const ids = reachable.nodes.map((node) => node.id);
    expect(ids).toContain("function:src/store/db.ts#save");
    expect(ids).toContain("function:src/util.ts#fmt");
    expect(ids).not.toContain("module:vendor.ts");
    expect(validateGraph(reachable)).toEqual([]);
  });

  it("throws for unknown nodes", () => {
    expect(() => reachableFrom(graph, "module:ghost.ts")).toThrow(/not in the graph/);
  });
});
