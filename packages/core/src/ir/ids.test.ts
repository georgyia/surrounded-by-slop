import { describe, expect, it } from "vitest";
import {
  buildGraph,
  canonicalizeGraph,
  declarationId,
  edgeId,
  externalModuleId,
  IdAllocator,
  moduleId,
  unresolvedFunctionId,
} from "./ids.js";
import type { SemanticGraph } from "./types.js";

describe("id grammar", () => {
  it("builds ids per the spec", () => {
    expect(moduleId("src/app.ts")).toBe("module:src/app.ts");
    expect(externalModuleId("react")).toBe("module:external:react");
    expect(declarationId("function", "src/util.ts", "outer.inner")).toBe(
      "function:src/util.ts#outer.inner",
    );
    expect(unresolvedFunctionId("dynamic")).toBe("function:unresolved#dynamic");
    expect(edgeId("calls", "a", "b")).toBe("calls:a->b");
  });
});

describe("IdAllocator", () => {
  it("keeps the first occurrence unsuffixed and numbers later collisions", () => {
    const ids = new IdAllocator();
    expect(ids.allocate("function:a.ts#f")).toBe("function:a.ts#f");
    expect(ids.allocate("function:a.ts#f")).toBe("function:a.ts#f~2");
    expect(ids.allocate("function:a.ts#f")).toBe("function:a.ts#f~3");
    expect(ids.allocate("function:a.ts#g")).toBe("function:a.ts#g");
  });
});

describe("canonicalizeGraph", () => {
  const unsorted: SemanticGraph = {
    schemaVersion: 1,
    nodes: [
      { id: "module:b.ts", kind: "module", name: "b.ts", qualifiedName: "b.ts" },
      { id: "module:a.ts", kind: "module", name: "a.ts", qualifiedName: "a.ts" },
    ],
    edges: [
      {
        id: "imports:module:b.ts->module:a.ts",
        kind: "imports",
        from: "module:b.ts",
        to: "module:a.ts",
      },
    ],
  };

  it("sorts nodes and edges by id without mutating the input", () => {
    const before = [...unsorted.nodes];
    const canonical = canonicalizeGraph(unsorted);
    expect(canonical.nodes.map((n) => n.id)).toEqual(["module:a.ts", "module:b.ts"]);
    expect(unsorted.nodes).toEqual(before);
  });

  it("buildGraph produces the same canonical result", () => {
    expect(buildGraph(unsorted.nodes, unsorted.edges)).toEqual(canonicalizeGraph(unsorted));
  });
});
