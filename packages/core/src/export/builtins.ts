import { dotExporter } from "./dot.js";
import { drawioExporter } from "./drawio.js";
import { createExporterRegistry, type Exporter, type ExporterRegistry } from "./exporter.js";
import { jsonExporter } from "./json.js";
import { mermaidExporter } from "./mermaid.js";
import { plantumlExporter } from "./plantuml.js";
import { svgExporter } from "./svg.js";

/**
 * The formats this project ships, in the order a host should offer them.
 *
 * The `Exporter` contract was meant to make a new format "one module plus a
 * registration", but hosts were re-listing the formats by hand — a switch on
 * the file extension in one place, a save-dialog filter list in another — so
 * every new exporter meant editing code in packages that should not care. This
 * list is the single place that knows what exists; hosts read it.
 */
export const builtinExporters: readonly Exporter[] = [
  drawioExporter,
  mermaidExporter,
  dotExporter,
  plantumlExporter,
  svgExporter,
  jsonExporter,
];

/** A registry preloaded with {@link builtinExporters}. */
export function createDefaultExporterRegistry(): ExporterRegistry {
  const registry = createExporterRegistry();
  for (const exporter of builtinExporters) {
    registry.register(exporter);
  }
  return registry;
}
