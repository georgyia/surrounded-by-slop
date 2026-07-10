import { describe, expect, it } from "vitest";
import type { GraphLayout } from "../layout/layout.js";
import { layoutGraph } from "../layout/layout.js";
import { analyzeTypeScriptProject } from "../typescript/adapter.js";
import { drawioExporter } from "./drawio.js";

const { graph } = analyzeTypeScriptProject([
  {
    path: "src/app.ts",
    text: ['import { save } from "./db";', "export function main(): void {", "  save();", "}"].join(
      "\n",
    ),
  },
  { path: "src/db.ts", text: "export function save(): void {}" },
]);

/** Hand-positioned layout: goldens stay byte-stable regardless of elkjs internals. */
const syntheticLayout: GraphLayout = {
  width: 460,
  height: 100,
  nodes: [
    {
      id: "function:src/app.ts#main",
      x: 16,
      y: 40,
      width: 120,
      height: 32,
      label: "main()",
      container: false,
    },
    {
      id: "function:src/db.ts#save",
      x: 276,
      y: 40,
      width: 120,
      height: 32,
      label: "save()",
      container: false,
    },
    {
      id: "module:src/app.ts",
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      label: "src/app.ts",
      container: true,
    },
    {
      id: "module:src/db.ts",
      x: 260,
      y: 0,
      width: 200,
      height: 100,
      label: "src/db.ts",
      container: true,
    },
  ],
  edges: [
    {
      id: "calls:function:src/app.ts#main->function:src/db.ts#save",
      points: [
        { x: 136, y: 56 },
        { x: 206, y: 56 },
        { x: 276, y: 56 },
      ],
    },
    {
      id: "imports:module:src/app.ts->module:src/db.ts",
      points: [
        { x: 200, y: 80 },
        { x: 260, y: 80 },
      ],
    },
  ],
};

describe("drawio exporter", () => {
  it("demands a layout", () => {
    expect(() => drawioExporter.export(graph)).toThrow(/layoutGraph/);
  });

  it("emits exactly the expected uncompressed mxGraph xml", () => {
    expect(drawioExporter.export(graph, { layout: syntheticLayout })).toBe(
      [
        '<mxfile host="surrounded-by-slop">',
        '  <diagram id="code-map" name="Code Map">',
        '    <mxGraphModel dx="1000" dy="600" grid="0" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" math="0" shadow="0">',
        "      <root>",
        '        <mxCell id="0" />',
        '        <mxCell id="1" parent="0" />',
        '        <mxCell id="function:src/app.ts#main" value="main()" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#D5E8D4;strokeColor=#82B366;" vertex="1" parent="module:src/app.ts">',
        '          <mxGeometry x="16" y="40" width="120" height="32" as="geometry" />',
        "        </mxCell>",
        '        <mxCell id="function:src/db.ts#save" value="save()" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#D5E8D4;strokeColor=#82B366;" vertex="1" parent="module:src/db.ts">',
        '          <mxGeometry x="16" y="40" width="120" height="32" as="geometry" />',
        "        </mxCell>",
        '        <mxCell id="module:src/app.ts" value="src/app.ts" style="rounded=1;whiteSpace=wrap;html=1;verticalAlign=top;align=left;spacingLeft=8;fontStyle=1;fillColor=#F5F5F5;strokeColor=#666666;container=1;collapsible=1;" vertex="1" parent="1">',
        '          <mxGeometry x="0" y="0" width="200" height="100" as="geometry" />',
        "        </mxCell>",
        '        <mxCell id="module:src/db.ts" value="src/db.ts" style="rounded=1;whiteSpace=wrap;html=1;verticalAlign=top;align=left;spacingLeft=8;fontStyle=1;fillColor=#F5F5F5;strokeColor=#666666;container=1;collapsible=1;" vertex="1" parent="1">',
        '          <mxGeometry x="260" y="0" width="200" height="100" as="geometry" />',
        "        </mxCell>",
        '        <mxCell id="calls:function:src/app.ts#main-&gt;function:src/db.ts#save" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;endArrow=classic;strokeColor=#4D4D4D;" edge="1" parent="1" source="function:src/app.ts#main" target="function:src/db.ts#save">',
        '          <mxGeometry relative="1" as="geometry">',
        '            <Array as="points">',
        '              <mxPoint x="206" y="56" />',
        "            </Array>",
        "          </mxGeometry>",
        "        </mxCell>",
        '        <mxCell id="imports:module:src/app.ts-&gt;module:src/db.ts" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;endArrow=open;dashed=1;strokeColor=#6C8EBF;" edge="1" parent="1" source="module:src/app.ts" target="module:src/db.ts">',
        '          <mxGeometry relative="1" as="geometry" />',
        "        </mxCell>",
        "      </root>",
        "    </mxGraphModel>",
        "  </diagram>",
        "</mxfile>",
        "",
      ].join("\n"),
    );
  });

  it("stays structurally sound and deterministic with the real layout", async () => {
    const layout = await layoutGraph(graph);
    const first = drawioExporter.export(graph, { layout });
    const second = drawioExporter.export(graph, { layout: await layoutGraph(graph) });
    expect(second).toBe(first);

    const cellOpens = first.match(/<mxCell /g)?.length ?? 0;
    const cellCloses =
      (first.match(/<\/mxCell>/g)?.length ?? 0) + (first.match(/<mxCell [^>]*\/>/g)?.length ?? 0);
    expect(cellOpens).toBe(cellCloses);
    // 2 root cells + 4 vertices + 2 edges
    expect(cellOpens).toBe(8);
    const ids = [...first.matchAll(/<mxCell id="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(first.match(/<mxGeometry [^>]*as="geometry"/g)?.length).toBe(6);
  });

  it("escapes hostile labels and ids", () => {
    const hostile = analyzeTypeScriptProject([
      { path: "a.ts", text: "export class B {\n  '\"<&>\"'(): void {}\n}" },
    ]).graph;
    const boxes: GraphLayout = {
      width: 100,
      height: 100,
      nodes: hostile.nodes.map((node, index) => ({
        id: node.id,
        x: index * 10,
        y: index * 50,
        width: 10,
        height: 10,
        label: node.name,
        container: false,
      })),
      edges: [],
    };
    const output = drawioExporter.export(hostile, { layout: boxes });
    expect(output).toContain("&quot;&lt;&amp;&gt;&quot;");
    expect(output).not.toMatch(/value="[^"]*</);
  });
});
