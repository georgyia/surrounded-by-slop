import { describe, expect, it } from "vitest";
import { validateGraph } from "../ir/validate.js";
import { analyzeTypeScriptProject } from "../typescript/adapter.js";
import {
  collapseToFolders,
  collapseToModules,
  expandableIds,
  expandNodes,
  filterGraph,
  reachableFrom,
  reachedBy,
  shortestPath,
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

describe("expandNodes", () => {
  it("with no expansion is the module map — members hidden", () => {
    const collapsed = expandNodes(graph, []);
    expect(collapsed.nodes.some((node) => node.id === "module:src/app.ts")).toBe(true);
    expect(collapsed.nodes.some((node) => node.id === "function:src/app.ts#main")).toBe(false);
    expect(validateGraph(collapsed)).toEqual([]);
  });

  it("reveals a module's members when it is expanded, and keeps the nesting", () => {
    const expanded = expandNodes(graph, ["module:src/app.ts"]);
    expect(expanded.nodes.some((node) => node.id === "function:src/app.ts#main")).toBe(true);
    // The containment edge to the revealed member survives so the layout nests it.
    expect(
      expanded.edges.some(
        (edge) =>
          edge.kind === "contains" &&
          edge.from === "module:src/app.ts" &&
          edge.to === "function:src/app.ts#main",
      ),
    ).toBe(true);
    // An unexpanded module stays a leaf.
    expect(expanded.nodes.some((node) => node.id === "function:src/store/db.ts#save")).toBe(false);
    expect(validateGraph(expanded)).toEqual([]);
  });

  it("lifts a revealed member's call edge to the still-collapsed target module", () => {
    const expanded = expandNodes(graph, ["module:src/app.ts"]);
    expect(
      expanded.edges.some(
        (edge) =>
          edge.kind === "calls" &&
          edge.from === "function:src/app.ts#main" &&
          edge.to === "module:src/store/db.ts",
      ),
    ).toBe(true);
  });

  it("names the expandable nodes: containers with hidden members that are shown", () => {
    const displayed = expandNodes(graph, []);
    const ids = expandableIds(graph, displayed, []);
    expect(ids).toContain("module:src/app.ts");
    // Once expanded it is no longer 'expandable' (it is collapsible instead).
    const afterExpand = expandNodes(graph, ["module:src/app.ts"]);
    expect(expandableIds(graph, afterExpand, ["module:src/app.ts"])).not.toContain(
      "module:src/app.ts",
    );
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

describe("reachedBy", () => {
  it("finds the callers of a function", () => {
    const callers = reachedBy(graph, "function:src/store/db.ts#save");
    const ids = callers.nodes.map((node) => node.id);
    expect(ids).toContain("function:src/app.ts#main"); // main calls save
    expect(ids).not.toContain("function:src/util.ts#fmt"); // fmt does not reach save
    expect(validateGraph(callers)).toEqual([]);
  });

  it("finds the importers of a module", () => {
    const importers = reachedBy(graph, "module:src/store/db.ts", ["imports"]);
    const ids = importers.nodes.map((node) => node.id);
    expect(ids).toContain("module:src/app.ts"); // app imports the db module
    expect(ids).not.toContain("module:vendor.ts");
  });

  it("returns just the start node when nothing reaches it", () => {
    const callers = reachedBy(graph, "function:src/app.ts#main");
    expect(callers.nodes.map((node) => node.id)).toEqual(["function:src/app.ts#main"]);
  });

  it("bounds the walk with maxDepth", () => {
    // main → fmt (depth 1) is reachable forward; depth 0 keeps only the start.
    const depth0 = reachableFrom(graph, "function:src/app.ts#main", ["calls"], 0);
    expect(depth0.nodes.map((node) => node.id)).toEqual(["function:src/app.ts#main"]);
    const depth1 = reachableFrom(graph, "function:src/app.ts#main", ["calls"], 1);
    expect(depth1.nodes.map((node) => node.id)).toContain("function:src/util.ts#fmt");
  });

  it("throws for unknown nodes", () => {
    expect(() => reachedBy(graph, "module:ghost.ts")).toThrow(/not in the graph/);
  });
});

describe("shortestPath", () => {
  it("finds the directed chain from one symbol to another", () => {
    const path = shortestPath(graph, "function:src/app.ts#main", "function:src/store/db.ts#save");
    expect(path).toEqual(["function:src/app.ts#main", "function:src/store/db.ts#save"]);
  });

  it("returns a single-node path from a node to itself", () => {
    const path = shortestPath(graph, "function:src/app.ts#main", "function:src/app.ts#main");
    expect(path).toEqual(["function:src/app.ts#main"]);
  });

  it("returns undefined when the target is unreachable", () => {
    const path = shortestPath(graph, "function:src/store/db.ts#save", "function:src/app.ts#main");
    expect(path).toBeUndefined();
  });

  it("throws when an endpoint is missing", () => {
    expect(() => shortestPath(graph, "function:src/app.ts#main", "module:ghost.ts")).toThrow(
      /not in the graph/,
    );
  });
});
