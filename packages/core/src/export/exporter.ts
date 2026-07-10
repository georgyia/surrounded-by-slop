import type { SemanticGraph } from "../ir/types.js";
import type { GraphLayout } from "../layout/layout.js";

/**
 * Exporters turn graphs into bytes. The contract keeps them honest: consume
 * the IR (plus a precomputed layout when positions matter), emit
 * deterministic text, and register like language adapters do. Anything
 * asynchronous (layout) happens before export, never inside it.
 */

export interface ExportOptions {
  /** Flowchart-style graph or a UML-ish class view (exporter-dependent). */
  view?: "graph" | "class";
  /** Flow direction for text formats. */
  direction?: "LR" | "TD";
  /** Color theme for rendered formats. */
  theme?: "light" | "dark";
  /** Precomputed positions — required when `needsLayout` is true. */
  layout?: GraphLayout;
}

export interface Exporter {
  readonly id: string;
  readonly displayName: string;
  /** Including the dot, e.g. `.mmd`. */
  readonly fileExtension: string;
  /** True when the format encodes positions and requires `options.layout`. */
  readonly needsLayout: boolean;
  export(graph: SemanticGraph, options?: ExportOptions): string;
}

/** Shared guard for position-dependent exporters. */
export function requiredLayout(exporter: Exporter, options?: ExportOptions): GraphLayout {
  const layout = options?.layout;
  if (layout === undefined) {
    throw new Error(
      `exporter ${exporter.id} needs a layout — compute one with layoutGraph() and pass it in options.layout`,
    );
  }
  return layout;
}

export interface ExporterRegistry {
  register(exporter: Exporter): void;
  byId(id: string): Exporter | undefined;
  all(): readonly Exporter[];
}

export function createExporterRegistry(): ExporterRegistry {
  const exporters = new Map<string, Exporter>();
  return {
    register(exporter) {
      if (exporters.has(exporter.id)) {
        throw new Error(`exporter ${exporter.id} is already registered`);
      }
      exporters.set(exporter.id, exporter);
    },
    byId(id) {
      return exporters.get(id);
    },
    all() {
      return [...exporters.values()];
    },
  };
}
