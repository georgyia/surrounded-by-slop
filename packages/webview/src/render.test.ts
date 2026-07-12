import type { GraphLayout, SemanticGraph } from "@surrounded-by-slop/core";
import { analyzeTypeScriptProject, layoutGraph } from "@surrounded-by-slop/core";
import { describe, expect, it } from "vitest";
import { renderDiagram } from "./render.js";

function countMatches(haystack: string, needle: RegExp): number {
  return haystack.match(needle)?.length ?? 0;
}

describe("renderDiagram", () => {
  it("draws one clickable, id-tagged group per leaf node", async () => {
    const { graph } = analyzeTypeScriptProject([
      {
        path: "sample.ts",
        text: "export class A {\n  m() { this.n(); }\n  n() {}\n}\nfunction f() { f(); }\n",
      },
    ]);
    const layout = await layoutGraph(graph);
    const svg = renderDiagram(graph, layout, "light");

    const leaves = layout.nodes.filter((node) => !node.container);
    expect(leaves.length).toBeGreaterThan(0);
    // One `.slop-node` group per leaf (containers are separate `.slop-container`).
    expect(countMatches(svg, /class="slop-node"/g)).toBe(leaves.length);
    for (const leaf of leaves) {
      expect(svg).toContain(`data-node-id="${leaf.id}"`);
    }
  });

  it("marks collapsed containers as expandable and expanded ones as collapsible", async () => {
    const { graph } = analyzeTypeScriptProject([
      { path: "m.ts", text: "export function a() {}\nexport function b() { a(); }\n" },
    ]);
    const layout = await layoutGraph(graph);
    // The module is a container in this layout; render it as collapsed instead.
    const flat: GraphLayout = {
      ...layout,
      nodes: layout.nodes.map((node) => ({ ...node, container: false })),
    };
    const moduleId = graph.nodes.find((node) => node.kind === "module")?.id ?? "";
    const svg = renderDiagram(graph, flat, "light", [moduleId]);
    expect(svg).toContain('data-expandable="expand"');
    expect(svg).toContain(`data-node-id="${moduleId}"`);

    // With the real (nested) layout the module is a container → collapsible.
    const nested = renderDiagram(graph, layout, "light", []);
    expect(nested).toContain('data-expandable="collapse"');
  });

  it("wraps the drawing in a single pan/zoom viewport group", () => {
    const svg = renderDiagram(emptyGraph, emptyLayout, "light");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(countMatches(svg, /class="slop-viewport"/g)).toBe(1);
    expect(svg).toContain("</svg>");
  });

  it("escapes node labels so hostile names can't break out of the SVG", () => {
    const graph: SemanticGraph = {
      schemaVersion: 1,
      nodes: [{ id: "n1", kind: "function", name: "a<b>", qualifiedName: "a<b>" }],
      edges: [],
    };
    const layout: GraphLayout = {
      width: 120,
      height: 40,
      nodes: [
        { id: "n1", x: 0, y: 0, width: 120, height: 30, label: 'a<b> & "c"', container: false },
      ],
      edges: [],
    };
    const svg = renderDiagram(graph, layout, "light");
    expect(svg).toContain("a&lt;b&gt; &amp; &quot;c&quot;");
    expect(svg).not.toContain("<b>");
  });

  it("switches palette with the theme", () => {
    const { graph } = analyzeTypeScriptProject([{ path: "f.ts", text: "function f() {}\n" }]);
    return layoutGraph(graph).then((layout) => {
      const light = renderDiagram(graph, layout, "light");
      const dark = renderDiagram(graph, layout, "dark");
      expect(light).toContain("#dafbe1"); // light function fill
      expect(dark).not.toContain("#dafbe1");
      expect(dark).toContain("#3fb950"); // dark function stroke/fill
    });
  });

  it("omits containment edges (nesting shows them) but draws call edges", async () => {
    const { graph } = analyzeTypeScriptProject([
      { path: "c.ts", text: "function a() { b(); }\nfunction b() {}\n" },
    ]);
    const layout = await layoutGraph(graph);
    const svg = renderDiagram(graph, layout, "light");
    // a → b call becomes a polyline; the module→function contains edges do not.
    expect(svg).toContain("<polyline");
    const containsEdges = graph.edges.filter((edge) => edge.kind === "contains").length;
    expect(containsEdges).toBeGreaterThan(0);
    expect(countMatches(svg, /<polyline/g)).toBeLessThan(graph.edges.length);
  });

  it("styles heritage and low-confidence edges distinctly", () => {
    const graph: SemanticGraph = {
      schemaVersion: 1,
      nodes: [
        { id: "a", kind: "class", name: "A", qualifiedName: "A" },
        { id: "b", kind: "class", name: "B", qualifiedName: "B" },
        { id: "f", kind: "function", name: "f", qualifiedName: "f" },
        { id: "g", kind: "function", name: "g", qualifiedName: "g" },
      ],
      edges: [
        { id: "extends:a->b", kind: "extends", from: "a", to: "b" },
        { id: "implements:a->b", kind: "implements", from: "a", to: "b" },
        { id: "calls:f->g", kind: "calls", from: "f", to: "g", confidence: "low" },
      ],
    };
    const point = { x: 0, y: 0 };
    const layout: GraphLayout = {
      width: 100,
      height: 100,
      nodes: [],
      edges: graph.edges.map((edge) => ({ id: edge.id, points: [point, { x: 10, y: 10 }] })),
    };
    const svg = renderDiagram(graph, layout, "light");
    expect(svg).toContain("#8250df"); // heritage stroke (extends/implements)
    expect(svg).toContain("url(#arrow-hollow)"); // hollow arrowhead for heritage
    expect(svg).toContain("#a8b1ba"); // dimmed low-confidence call
    expect(svg).toContain("url(#arrow-low)");
  });
});

const emptyGraph: SemanticGraph = { schemaVersion: 1, nodes: [], edges: [] };
const emptyLayout: GraphLayout = { width: 0, height: 0, nodes: [], edges: [] };
