import { describe, expect, it } from "vitest";
import type { SemanticGraph } from "../ir/types.js";
import { validateGraph } from "../ir/validate.js";
import { analyzeTypeScriptProject } from "../typescript/adapter.js";
import { jsonExporter } from "./json.js";

describe("json exporter", () => {
  const { graph } = analyzeTypeScriptProject([
    { path: "a.ts", text: 'import { b } from "./b";\nexport const a = b;' },
    { path: "b.ts", text: "export const b = 1;" },
  ]);

  it("round-trips to an equal, valid graph", () => {
    const output = jsonExporter.export(graph);
    const parsed = JSON.parse(output) as SemanticGraph;
    expect(validateGraph(parsed)).toEqual([]);
    expect(parsed).toEqual(graph);
  });

  it("emits canonical json with a trailing newline", () => {
    const output = jsonExporter.export(graph);
    expect(output.endsWith("}\n")).toBe(true);
    expect(output.indexOf('"edges"')).toBeLessThan(output.indexOf('"nodes"'));
    expect(jsonExporter.export(graph)).toBe(output);
  });
});
