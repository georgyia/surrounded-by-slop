import { describe, expect, it } from "vitest";
import { analyzeTypeScriptProject } from "../typescript/adapter.js";
import { mermaidExporter } from "./mermaid.js";

describe("mermaid flowchart", () => {
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

  it("renders nested subgraphs, shapes and edge styles exactly", () => {
    expect(mermaidExporter.export(graph)).toBe(
      [
        "flowchart LR",
        '  subgraph module_src_app_ts["src/app.ts"]',
        '    function_src_app_ts_main(["main()"])',
        "  end",
        '  subgraph module_src_db_ts["src/db.ts"]',
        '    function_src_db_ts_save(["save()"])',
        "  end",
        "  function_src_app_ts_main --> function_src_db_ts_save",
        "  module_src_app_ts -.-> module_src_db_ts",
        "",
      ].join("\n"),
    );
  });

  it("is deterministic and direction-aware", () => {
    expect(mermaidExporter.export(graph)).toBe(mermaidExporter.export(graph));
    expect(mermaidExporter.export(graph, { direction: "TD" }).startsWith("flowchart TD")).toBe(
      true,
    );
  });

  it("survives hostile names (quotes, brackets, pipes, unicode)", () => {
    const hostile = analyzeTypeScriptProject([
      {
        path: "src/we|ird.ts",
        text: [
          "export class Box {",
          "  '\"quoted|name\"'(): void {}",
          "  '[brackets]'(): void {}",
          "  'ümläut→'(): void {}",
          "}",
        ].join("\n"),
      },
    ]).graph;
    const output = mermaidExporter.export(hostile);
    expect(output).toContain('(["#quot;quoted|name#quot;()"])');
    expect(output).toContain('(["[brackets]()"])');
    expect(output).toContain('(["ümläut→()"])');
    // every label sits inside a quoted string — raw double quotes never leak
    for (const line of output.split("\n")) {
      expect(line.split('"').length % 2, `unbalanced quotes in: ${line}`).toBe(1);
    }
  });

  it("marks low confidence, type-only imports and merged counts", () => {
    const { graph: marked } = analyzeTypeScriptProject([
      {
        path: "a.ts",
        text: [
          'import type { T } from "./b";',
          "export function go(): void {",
          "  phantom();",
          "  phantom();",
          "}",
        ].join("\n"),
      },
      { path: "b.ts", text: "export interface T { x: number }" },
    ]);
    const output = mermaidExporter.export(marked);
    expect(output).toContain('-.->|"? 2×"| function_unresolved_phantom');
    expect(output).toContain('module_a_ts -.->|"type"| module_b_ts');
  });
});

describe("mermaid class view", () => {
  const { graph } = analyzeTypeScriptProject([
    {
      path: "src/shapes.ts",
      text: [
        "export interface Shape {",
        "  area(): number;",
        "}",
        "export class Circle implements Shape {",
        "  radius = 1;",
        "  area(): number {",
        "    return this.radius;",
        "  }",
        "  #hidden(): void {}",
        "}",
        "export class Wheel extends Circle {}",
        "export enum Kind { A, B }",
        "export function helper(): void {}",
      ].join("\n"),
    },
  ]);
  const output = mermaidExporter.export(graph, { view: "class" });

  it("renders classes, interfaces and enums with members and relations", () => {
    expect(output).toBe(
      [
        "classDiagram",
        '  class class_src_shapes_ts_Circle["Circle"] {',
        "    -hidden() void",
        "    +area() number",
        "  }",
        '  class class_src_shapes_ts_Wheel["Wheel"] {',
        "  }",
        '  class enum_src_shapes_ts_Kind["Kind"] {',
        "    <<enumeration>>",
        "  }",
        '  class interface_src_shapes_ts_Shape["Shape"] {',
        "    <<interface>>",
        "  }",
        "  class_src_shapes_ts_Circle <|-- class_src_shapes_ts_Wheel",
        "  interface_src_shapes_ts_Shape <|.. class_src_shapes_ts_Circle",
        "",
      ].join("\n"),
    );
  });

  it("maps generics to mermaid tildes", () => {
    const generic = analyzeTypeScriptProject([
      {
        path: "g.ts",
        text: "export class Store {\n  get(key: Map<string, number>): Set<string> {\n    return new Set();\n  }\n}",
      },
    ]).graph;
    const view = mermaidExporter.export(generic, { view: "class" });
    expect(view).toContain("+get(key: Map~string, number~) Set~string~");
    expect(view).not.toContain("<string>");
  });
});
