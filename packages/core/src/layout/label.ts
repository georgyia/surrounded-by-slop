import type { GraphNode } from "../ir/types.js";

/**
 * The display label every visual consumer agrees on — layout sizes nodes for
 * it, and draw.io/SVG render it, so text always fits its box.
 */
export function displayLabel(node: GraphNode): string {
  if (node.kind === "function" || node.kind === "method") {
    return `${node.name}()`;
  }
  if (node.kind === "module") {
    return node.name;
  }
  return node.name;
}
