import { describe, expect, it } from "vitest";
import { buildGraph } from "../ir/ids.js";
import { createExporterRegistry, type Exporter, requiredLayout } from "./exporter.js";

const emptyGraph = buildGraph([], []);

const textExporter: Exporter = {
  id: "noop",
  displayName: "No-op",
  fileExtension: ".txt",
  needsLayout: false,
  export: (graph) => `nodes:${graph.nodes.length}`,
};

const positionedExporter: Exporter = {
  id: "positioned",
  displayName: "Positioned",
  fileExtension: ".pos",
  needsLayout: true,
  export(graph, options) {
    const layout = requiredLayout(this, options);
    return `${graph.nodes.length}@${layout.width}x${layout.height}`;
  },
};

describe("exporter contract", () => {
  it("plain exporters run without a layout", () => {
    expect(textExporter.export(emptyGraph)).toBe("nodes:0");
  });

  it("position-dependent exporters demand a layout with a helpful error", () => {
    expect(() => positionedExporter.export(emptyGraph)).toThrow(/layoutGraph\(\)/);
    expect(
      positionedExporter.export(emptyGraph, {
        layout: { width: 10, height: 5, nodes: [], edges: [] },
      }),
    ).toBe("0@10x5");
  });
});

describe("createExporterRegistry", () => {
  it("registers and looks up exporters", () => {
    const registry = createExporterRegistry();
    registry.register(textExporter);
    registry.register(positionedExporter);
    expect(registry.byId("noop")).toBe(textExporter);
    expect(registry.byId("missing")).toBeUndefined();
    expect(registry.all().map((e) => e.id)).toEqual(["noop", "positioned"]);
  });

  it("rejects double registration", () => {
    const registry = createExporterRegistry();
    registry.register(textExporter);
    expect(() => registry.register(textExporter)).toThrow(/already registered/);
  });
});
