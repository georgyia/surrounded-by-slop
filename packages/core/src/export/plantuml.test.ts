import { describe, expect, it } from "vitest";
import { analyzeTypeScriptProject } from "../typescript/adapter.js";
import { plantumlExporter } from "./plantuml.js";

describe("plantuml component view", () => {
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

  it("renders packages, stereotypes and edge styles exactly", () => {
    expect(plantumlExporter.export(graph)).toBe(
      [
        "@startuml",
        "left to right direction",
        'package "src/app.ts" as module_src_app_ts <<module>> {',
        '  rectangle "main()" as function_src_app_ts_main <<function>>',
        "}",
        'package "src/db.ts" as module_src_db_ts <<module>> {',
        '  rectangle "save()" as function_src_db_ts_save <<function>>',
        "}",
        "function_src_app_ts_main -[#57606a]-> function_src_db_ts_save",
        "module_src_app_ts .[#57606a].> module_src_db_ts",
        "@enduml",
        "",
      ].join("\n"),
    );
  });

  it("wraps every diagram in the @startuml/@enduml PlantUML requires", () => {
    const output = plantumlExporter.export(graph);
    expect(output.startsWith("@startuml\n")).toBe(true);
    expect(output.endsWith("@enduml\n")).toBe(true);
    const classView = plantumlExporter.export(graph, { view: "class" });
    expect(classView.startsWith("@startuml\n")).toBe(true);
    expect(classView.endsWith("@enduml\n")).toBe(true);
  });

  it("is deterministic and direction-aware", () => {
    expect(plantumlExporter.export(graph)).toBe(plantumlExporter.export(graph));
    // PlantUML is top-down by default, so TD is the absence of the directive.
    expect(plantumlExporter.export(graph, { direction: "TD" })).not.toContain(
      "left to right direction",
    );
    expect(plantumlExporter.export(graph, { direction: "LR" })).toContain(
      "left to right direction",
    );
  });

  it("needs no layout — PlantUML lays out itself", () => {
    expect(plantumlExporter.needsLayout).toBe(false);
    expect(() => plantumlExporter.export(graph)).not.toThrow();
  });

  it("dots heuristic and type-only edges so a guess never reads as a fact", () => {
    const { graph: mixed } = analyzeTypeScriptProject([
      {
        path: "src/main.ts",
        text: [
          'import type { Config } from "./config";',
          "export interface Runnable { go(): void }",
          "export class Base {}",
          "export class Impl extends Base implements Runnable {",
          "  go(): void { phantom(); }",
          "}",
          "export const use = (c: Config) => c;",
        ].join("\n"),
      },
      { path: "src/config.ts", text: "export interface Config { on: boolean }" },
    ]);
    const output = plantumlExporter.export(mixed);

    // extends is solid and heritage-coloured; implements is the dotted variant.
    expect(output).toMatch(/Impl -\[#8250df\]-> \S*Base : extends/);
    expect(output).toMatch(/Impl \.\[#8250df\]\.> \S*Runnable : implements/);
    // An unresolved call and a type-only import are both dimmed and dotted.
    for (const line of output.split("\n")) {
      if (line.endsWith(": ?") || line.endsWith(": type")) {
        expect(line).toContain(".[#a8b1ba].>");
      }
    }
    expect(output).toContain(": ?");
    expect(output).toContain(": type");
  });

  it("renders a UML class diagram for the class view", () => {
    const { graph: classes } = analyzeTypeScriptProject([
      {
        path: "src/shapes.ts",
        text: [
          "export interface Drawable { draw(): void }",
          "export enum Mode { On }",
          "export class Shape {",
          "  area(scale: number): number { return scale }",
          "  #secret(): void {}",
          "}",
          "export class Circle extends Shape implements Drawable {",
          "  draw(): void {}",
          "}",
        ].join("\n"),
      },
    ]);
    const output = plantumlExporter.export(classes, { view: "class" });

    // First-class UML keywords, not <<stereotype>> approximations.
    expect(output).toContain('interface "Drawable" as');
    expect(output).toContain('enum "Mode" as');
    expect(output).toContain('class "Shape" as');
    // Visibility and return types come through UML-style.
    expect(output).toContain("+area(scale: number) : number");
    expect(output).toContain("-secret()");
    // Generalization is solid; realization dotted — the UML convention.
    expect(output).toMatch(/\S*Shape <\|-- \S*Circle/);
    expect(output).toMatch(/\S*Drawable <\|\.\. \S*Circle/);
    // A class view is about types, so call/import edges stay out of it.
    expect(output).not.toContain("rectangle");
  });

  it("declares member-less types without an empty body", () => {
    const { graph: bare } = analyzeTypeScriptProject([
      { path: "src/bare.ts", text: "export class Empty {}" },
    ]);
    const output = plantumlExporter.export(bare, { view: "class" });
    expect(output).toContain('class "Empty" as class_src_bare_ts_Empty\n');
    expect(output).not.toContain("{");
  });

  it("survives hostile names (quotes, unicode) without breaking the label", () => {
    const { graph: hostile } = analyzeTypeScriptProject([
      {
        path: "src/we|ird.ts",
        text: [
          "export class Box {",
          "  '\"quoted\"'(): void {}",
          "  'ümläut→'(): void {}",
          "}",
        ].join("\n"),
      },
    ]);
    const output = plantumlExporter.export(hostile);
    // PlantUML cannot escape a quote inside a quoted label, so it is swapped
    // for a typographic one — the label never terminates early.
    expect(output).toContain("”quoted”()");
    expect(output).toContain("ümläut→()");
    for (const line of output.split("\n")) {
      expect((line.match(/"/g) ?? []).length % 2).toBe(0);
    }
    // Aliases stay bare identifiers.
    for (const alias of output.matchAll(/ as ([^\s<{]+)/g)) {
      expect(alias[1]).toMatch(/^[A-Za-z0-9_]+$/);
    }
  });

  it("registers itself as a .puml exporter", () => {
    expect(plantumlExporter.id).toBe("plantuml");
    expect(plantumlExporter.fileExtension).toBe(".puml");
    expect(plantumlExporter.displayName).toBe("PlantUML");
  });
});
