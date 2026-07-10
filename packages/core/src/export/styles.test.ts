import { describe, expect, it } from "vitest";
import type { GraphLayout } from "../layout/layout.js";
import { analyzeTypeScriptProject } from "../typescript/adapter.js";
import { drawioExporter } from "./drawio.js";
import { mermaidExporter } from "./mermaid.js";
import { svgExporter } from "./svg.js";

/**
 * One kitchen-sink graph that exercises every visual style branch: heritage
 * edges, external packages, type-only imports, low-confidence calls,
 * enums and variables.
 */
const { graph } = analyzeTypeScriptProject([
  {
    path: "src/main.ts",
    text: [
      'import { render } from "react";',
      'import type { Config } from "./config";',
      "",
      "export interface Runnable {",
      "  go(): void;",
      "}",
      "",
      "export class Base {}",
      "",
      "export class Impl extends Base implements Runnable {",
      "  go(): void {",
      "    phantom();",
      "  }",
      "}",
      "",
      "export enum Mode {",
      "  On,",
      "}",
      "",
      "export const setting = 1;",
    ].join("\n"),
  },
  { path: "src/config.ts", text: "export interface Config { on: boolean }" },
]);

/** Boxes for every node plus one stray id; routes for all edges but one. */
const nonContains = graph.edges.filter((edge) => edge.kind !== "contains");
const layout: GraphLayout = {
  width: 600,
  height: 400,
  nodes: [
    ...graph.nodes.map((node, index) => ({
      id: node.id,
      x: (index % 5) * 110,
      y: Math.floor(index / 5) * 70,
      width: 90,
      height: 32,
      label: node.name,
      container: false,
    })),
    {
      id: "ghost:not-in-graph",
      x: 550,
      y: 350,
      width: 10,
      height: 10,
      label: "ghost",
      container: false,
    },
  ],
  edges: nonContains.slice(0, -1).map((edge) => ({
    id: edge.id,
    points: [
      { x: 0, y: 0 },
      { x: 20, y: 20 },
    ],
  })),
};

describe("style coverage across exporters", () => {
  it("draw.io styles every edge kind and node situation", () => {
    const output = drawioExporter.export(graph, { layout });
    expect(output).toContain("endArrow=block;endFill=0;endSize=10;strokeColor=#9673A6;"); // extends
    expect(output).toContain("endArrow=block;endFill=0;endSize=10;dashed=1;strokeColor=#9673A6;"); // implements
    expect(output).toContain("endArrow=open;dashed=1;strokeColor=#6C8EBF;"); // imports
    expect(output).toContain("endArrow=classic;dashed=1;strokeColor=#999999;"); // low confidence
    expect(output).toContain('value="extends"');
    expect(output).toContain('value="implements"');
    expect(output).toContain('value="type"');
    expect(output).toContain('value="?"');
    expect(output).toContain("dashed=1;fillColor=none;strokeColor=#8C959F;"); // external react
    expect(output).toContain("fillColor=#FFE6CC"); // enum
    expect(output).toContain("fillColor=#FFF2CC"); // variable
    expect(output).toContain("fillColor=#E1D5E7"); // interface
    expect(output).not.toContain("ghost:not-in-graph"); // stray boxes are skipped
  });

  it("svg styles heritage, low-confidence and external nodes in both themes", () => {
    const light = svgExporter.export(graph, { layout });
    expect(light).toContain('marker-end="url(#arrow-hollow)"'); // heritage arrows
    expect(light).toContain('marker-end="url(#arrow-low)"'); // low confidence
    expect(light).toContain('stroke-dasharray="4 3"'); // external node outline
    expect(light).toContain('fill="#fff1e5"'); // enum (light)
    // one edge deliberately has no route and is skipped
    expect(light.match(/<polyline /g)?.length).toBe(nonContains.length - 1);

    const dark = svgExporter.export(graph, { layout, theme: "dark" });
    expect(dark).toContain('fill-opacity="0.13"');
    expect(dark).toContain('stroke="#bc8cff"'); // heritage in dark
  });

  it("mermaid labels heritage, type-only and low-confidence edges", () => {
    const output = mermaidExporter.export(graph);
    expect(output).toContain('-->|"extends"|');
    expect(output).toContain('-.->|"implements"|');
    expect(output).toContain('-.->|"type"|');
    expect(output).toContain('-.->|"?"|');
    expect(output).toContain('(("react"))'); // external shape
    expect(output).toContain('["Mode"]'); // enum as plain rect
  });
});
