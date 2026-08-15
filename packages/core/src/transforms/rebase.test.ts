import { describe, expect, it } from "vitest";
import { validateGraph } from "../ir/validate.js";
import { analyzeTypeScriptProject } from "../typescript/adapter.js";
import { rebaseGraph } from "./rebase.js";

const project = analyzeTypeScriptProject([
  {
    path: "src/index.ts",
    text: ['import { save } from "./db";', "export function main(): void {", "  save();", "}"].join(
      "\n",
    ),
  },
  { path: "src/db.ts", text: 'import "react";\nexport function save(): void { missing(); }' },
]).graph;

describe("rebaseGraph", () => {
  it("returns the graph untouched for an empty prefix, so single-root ids never move", () => {
    expect(rebaseGraph(project, "")).toBe(project);
  });

  it("moves module ids, paths and spans under the prefix", () => {
    const moved = rebaseGraph(project, "web");
    const module = moved.nodes.find((node) => node.id === "module:web/src/index.ts");
    expect(module).toBeDefined();
    expect(module?.qualifiedName).toBe("web/src/index.ts");
    expect(module?.span?.file).toBe("web/src/index.ts");
    // `name` is the display label the adapter chose — rebasing must not touch it.
    const before = project.nodes.find((node) => node.id === "module:src/index.ts");
    expect(module?.name).toBe(before?.name);
  });

  it("moves declaration ids without touching their qualified names", () => {
    const moved = rebaseGraph(project, "web");
    const fn = moved.nodes.find((node) => node.id === "function:web/src/index.ts#main");
    expect(fn).toBeDefined();
    expect(fn?.qualifiedName).toBe("main");
    expect(fn?.span?.file).toBe("web/src/index.ts");
  });

  it("rebuilds edge ids so they still match their endpoints", () => {
    const moved = rebaseGraph(project, "web");
    for (const edge of moved.edges) {
      expect(edge.id).toBe(`${edge.kind}:${edge.from}->${edge.to}`);
      expect(moved.nodes.some((node) => node.id === edge.from)).toBe(true);
      expect(moved.nodes.some((node) => node.id === edge.to)).toBe(true);
    }
  });

  it("leaves external packages alone, so two roots share one react node", () => {
    const web = rebaseGraph(project, "web");
    const api = rebaseGraph(project, "api");
    const externalOf = (graph: typeof project): string[] =>
      graph.nodes.filter((node) => node.external === true).map((node) => node.id);
    expect(externalOf(web)).toEqual(externalOf(api));
    expect(externalOf(web).some((id) => id.includes("react"))).toBe(true);
  });

  it("leaves unresolved-call sinks alone — they name no file", () => {
    const moved = rebaseGraph(project, "web");
    const sink = moved.nodes.find((node) => node.id.startsWith("function:unresolved#"));
    expect(sink?.id).toBe("function:unresolved#missing");
  });

  it("keeps two roots' identically-pathed modules apart", () => {
    const web = rebaseGraph(project, "web");
    const api = rebaseGraph(project, "api");
    const ids = new Set([...web.nodes, ...api.nodes].map((node) => node.id));
    // Every project node is distinct; only the shared externals overlap.
    const projectNodes = [...web.nodes, ...api.nodes].filter(
      (node) => node.external !== true && !node.id.startsWith("function:unresolved#"),
    );
    expect(new Set(projectNodes.map((node) => node.id)).size).toBe(projectNodes.length);
    expect(ids.has("module:web/src/index.ts")).toBe(true);
    expect(ids.has("module:api/src/index.ts")).toBe(true);
  });

  it("produces a graph that still validates, and is canonically ordered", () => {
    const moved = rebaseGraph(project, "web");
    expect(validateGraph(moved)).toEqual([]);
    expect(moved.nodes.map((node) => node.id)).toEqual(
      [...moved.nodes.map((node) => node.id)].sort(),
    );
  });

  it("is deterministic", () => {
    expect(rebaseGraph(project, "web")).toEqual(rebaseGraph(project, "web"));
  });
});
