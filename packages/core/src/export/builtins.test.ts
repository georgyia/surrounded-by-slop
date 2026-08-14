import { describe, expect, it } from "vitest";
import { builtinExporters, createDefaultExporterRegistry } from "./builtins.js";

describe("builtinExporters", () => {
  it("ships every format the project claims to support", () => {
    expect(builtinExporters.map((exporter) => exporter.id)).toEqual([
      "drawio",
      "mermaid",
      "dot",
      "plantuml",
      "svg",
      "json",
    ]);
  });

  it("gives every format a distinct id, extension and display name", () => {
    const unique = (values: string[]): number => new Set(values).size;
    expect(unique(builtinExporters.map((exporter) => exporter.id))).toBe(builtinExporters.length);
    expect(unique(builtinExporters.map((exporter) => exporter.fileExtension))).toBe(
      builtinExporters.length,
    );
    expect(unique(builtinExporters.map((exporter) => exporter.displayName))).toBe(
      builtinExporters.length,
    );
  });

  it("names extensions with a leading dot, the form hosts strip", () => {
    for (const exporter of builtinExporters) {
      expect(exporter.fileExtension).toMatch(/^\.[a-z]+$/);
    }
  });
});

describe("createDefaultExporterRegistry", () => {
  it("preloads the built-ins, findable by id and by extension", () => {
    const registry = createDefaultExporterRegistry();
    expect(registry.all()).toHaveLength(builtinExporters.length);
    for (const exporter of builtinExporters) {
      expect(registry.byId(exporter.id)).toBe(exporter);
      expect(registry.byExtension(exporter.fileExtension)).toBe(exporter);
    }
  });

  it("hands back independent registries, so one host cannot affect another", () => {
    const first = createDefaultExporterRegistry();
    first.register({
      id: "extra",
      displayName: "Extra",
      fileExtension: ".extra",
      needsLayout: false,
      export: () => "",
    });
    expect(createDefaultExporterRegistry().byId("extra")).toBeUndefined();
  });
});
