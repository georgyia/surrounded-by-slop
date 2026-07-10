import { stableStringify } from "../stable-json.js";
import type { Exporter } from "./exporter.js";

/**
 * The escape hatch: the raw Semantic Graph as canonical JSON — sorted keys,
 * canonical node/edge order, trailing newline. The reference serialization
 * for anyone building on top without importing the library.
 */
export const jsonExporter: Exporter = {
  id: "json",
  displayName: "Semantic Graph JSON",
  fileExtension: ".json",
  needsLayout: false,
  export(graph) {
    return `${stableStringify(graph, 2)}\n`;
  },
};
