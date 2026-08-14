import { describe, expect, it } from "vitest";
import { analyzeTypeScriptProject } from "../typescript/adapter.js";
import { dotExporter } from "./dot.js";
import { LIGHT_THEME } from "./styles.js";

describe("graphviz dot", () => {
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

  it("renders clusters, shapes and edge styles exactly", () => {
    expect(dotExporter.export(graph)).toBe(
      [
        "digraph slop {",
        "  rankdir=LR;",
        '  bgcolor="#ffffff";',
        '  node [fontname="Helvetica", fontsize=11];',
        '  edge [fontname="Helvetica", fontsize=9];',
        "  subgraph cluster_module_src_app_ts {",
        '    label="src/app.ts";',
        '    style="rounded";',
        '    color="#d0d7de";',
        '    bgcolor="#f6f8fa";',
        '    fontcolor="#1f2328";',
        '    function_src_app_ts_main [label="main()", shape="box", style="rounded,filled", fillcolor="#dafbe1", color="#4ac26b", fontcolor="#1f2328"];',
        "  }",
        "  subgraph cluster_module_src_db_ts {",
        '    label="src/db.ts";',
        '    style="rounded";',
        '    color="#d0d7de";',
        '    bgcolor="#f6f8fa";',
        '    fontcolor="#1f2328";',
        '    function_src_db_ts_save [label="save()", shape="box", style="rounded,filled", fillcolor="#dafbe1", color="#4ac26b", fontcolor="#1f2328"];',
        "  }",
        '  function_src_app_ts_main -> function_src_db_ts_save [color="#57606a", penwidth="1.2"];',
        '  module_src_app_ts -> module_src_db_ts [color="#57606a", penwidth="1.2", style="dashed"];',
        "}",
        "",
      ].join("\n"),
    );
  });

  it("is deterministic and direction-aware", () => {
    expect(dotExporter.export(graph)).toBe(dotExporter.export(graph));
    expect(dotExporter.export(graph, { direction: "TD" })).toContain("rankdir=TB;");
    expect(dotExporter.export(graph, { direction: "LR" })).toContain("rankdir=LR;");
  });

  it("needs no layout — Graphviz does its own", () => {
    expect(dotExporter.needsLayout).toBe(false);
    expect(() => dotExporter.export(graph)).not.toThrow();
  });

  it("follows the shared palette in dark mode", () => {
    const dark = dotExporter.export(graph, { theme: "dark" });
    expect(dark).toContain('bgcolor="#0b0f17";');
    expect(dark).toContain('fontcolor="#e6edf3"');
    expect(dark).not.toContain(LIGHT_THEME.background);
  });

  it("keeps heuristic and type-only edges visually weaker than facts", () => {
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
    const output = dotExporter.export(mixed);

    // extends: heritage colour, hollow head, solid — a fact about the types.
    expect(output).toMatch(/Impl -> \S*Base \[color="#8250df", penwidth="1.2", arrowhead="empty"/);
    // implements: same colour, but dashed.
    expect(output).toMatch(/Impl -> \S*Runnable \[color="#8250df", penwidth="1.2", style="dashed"/);
    // an unresolved call is a guess, and says so.
    expect(output).toContain('color="#a8b1ba"');
    expect(output).toContain('label="?"');
    // a type-only import is erased before the code runs.
    expect(output).toContain('label="type"');
    for (const line of output.split("\n").filter((l) => l.includes("->"))) {
      if (line.includes('label="?"') || line.includes('label="type"')) {
        expect(line).toContain('style="dashed"');
      }
    }
  });

  it("draws external packages as dashed, unfilled ellipses", () => {
    const { graph: external } = analyzeTypeScriptProject([
      {
        path: "src/ui.ts",
        text: 'import { render } from "react";\nexport const go = () => render();',
      },
    ]);
    const output = dotExporter.export(external);
    expect(output).toMatch(/react[^\n]*shape="ellipse"[^\n]*style="filled,dashed"/);
    expect(output).toMatch(/react[^\n]*fillcolor="#ffffff"/);
  });

  it("survives hostile names (quotes, backslashes, unicode)", () => {
    const { graph: hostile } = analyzeTypeScriptProject([
      {
        path: "src/we|ird.ts",
        text: [
          "export class Box {",
          "  '\"quoted\\\\name\"'(): void {}",
          "  'ümläut→'(): void {}",
          "}",
        ].join("\n"),
      },
    ]);
    const output = dotExporter.export(hostile);
    // Quotes and backslashes are escaped, so every attribute stays parseable.
    expect(output).toContain('\\"quoted\\\\name\\"()');
    expect(output).toContain("ümläut→()");
    // Ids are sanitized to [A-Za-z0-9_], the only characters DOT takes unquoted.
    for (const line of output.split("\n")) {
      const declaration = /^\s*([A-Za-z0-9_]+) \[/.exec(line);
      if (declaration !== null) {
        expect(declaration[1]).toMatch(/^[A-Za-z0-9_]+$/);
      }
    }
  });

  it("registers itself as a .dot exporter", () => {
    expect(dotExporter.id).toBe("dot");
    expect(dotExporter.fileExtension).toBe(".dot");
    expect(dotExporter.displayName).toBe("Graphviz DOT");
  });
});
