import { describe, expect, it } from "vitest";
import { buildGraph, declarationId, edgeId, moduleId } from "../ir/ids.js";
import type { GraphLayout } from "../layout/layout.js";
import { layoutGraph } from "../layout/layout.js";
import { analyzeTypeScriptProject } from "../typescript/adapter.js";
import { svgExporter } from "./svg.js";

const tinyGraph = buildGraph(
  [
    { id: moduleId("a.ts"), kind: "module", name: "a.ts", qualifiedName: "a.ts" },
    {
      id: declarationId("function", "a.ts", "go"),
      kind: "function",
      name: "go",
      qualifiedName: "go",
    },
  ],
  [
    {
      id: edgeId("contains", moduleId("a.ts"), declarationId("function", "a.ts", "go")),
      kind: "contains",
      from: moduleId("a.ts"),
      to: declarationId("function", "a.ts", "go"),
    },
  ],
);

const tinyLayout: GraphLayout = {
  width: 200,
  height: 90,
  nodes: [
    {
      id: declarationId("function", "a.ts", "go"),
      x: 16,
      y: 40,
      width: 80,
      height: 32,
      label: "go()",
      container: false,
    },
    { id: moduleId("a.ts"), x: 0, y: 0, width: 200, height: 90, label: "a.ts", container: true },
  ],
  edges: [],
};

describe("svg exporter", () => {
  it("demands a layout", () => {
    expect(() => svgExporter.export(tinyGraph)).toThrow(/layoutGraph/);
  });

  it("emits exactly the expected light-theme svg", () => {
    expect(svgExporter.export(tinyGraph, { layout: tinyLayout })).toBe(
      [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 232 122" width="232" height="122" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="12">',
        "  <defs>",
        '    <marker id="arrow-solid" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9 z" fill="#57606a" /></marker>',
        '    <marker id="arrow-low" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9 z" fill="#a8b1ba" /></marker>',
        '    <marker id="arrow-hollow" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="10" markerHeight="10" orient="auto-start-reverse"><path d="M 1 1 L 11 6 L 1 11 z" fill="#ffffff" stroke="#8250df" /></marker>',
        "  </defs>",
        '  <rect width="100%" height="100%" fill="#ffffff" />',
        '  <g transform="translate(16,16)">',
        '    <rect x="0" y="0" width="200" height="90" rx="8" fill="#f6f8fa" stroke="#d0d7de" />',
        '    <text x="10" y="22" fill="#1f2328" font-weight="600">a.ts</text>',
        '    <rect x="16" y="40" width="80" height="32" rx="6" fill="#dafbe1" fill-opacity="1" stroke="#4ac26b" />',
        '    <text x="56" y="60" text-anchor="middle" fill="#1f2328">go()</text>',
        "  </g>",
        "</svg>",
        "",
      ].join("\n"),
    );
  });

  it("themes dark output distinctly", () => {
    const dark = svgExporter.export(tinyGraph, { layout: tinyLayout, theme: "dark" });
    expect(dark).toContain('fill="#0b0f17"');
    expect(dark).toContain('fill-opacity="0.13"');
    expect(dark).not.toContain('fill="#ffffff" />');
  });

  it("renders every non-contains edge and label exactly once on a real layout", async () => {
    const { graph } = analyzeTypeScriptProject([
      {
        path: "src/app.ts",
        text: [
          'import { save } from "./db";',
          "export function main(): void {",
          "  save();",
          "}",
        ].join("\n"),
      },
      { path: "src/db.ts", text: "export function save(): void {}" },
    ]);
    const layout = await layoutGraph(graph);
    const output = svgExporter.export(graph, { layout });

    const nonContains = graph.edges.filter((edge) => edge.kind !== "contains").length;
    expect(output.match(/<polyline /g)?.length).toBe(nonContains);
    expect(output.match(/>main\(\)</g)?.length).toBe(1);
    expect(output.match(/>save\(\)</g)?.length).toBe(1);
    expect(output).toContain('viewBox="0 0 ');

    expect(svgExporter.export(graph, { layout })).toBe(output);
  });
});
