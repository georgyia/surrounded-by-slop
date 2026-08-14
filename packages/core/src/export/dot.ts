import type { GraphEdge, GraphNode, SemanticGraph } from "../ir/types.js";
import { edgeEmphasis } from "../layout/edgeEmphasis.js";
import { displayLabel } from "../layout/label.js";
import type { Exporter, ExportOptions } from "./exporter.js";
import { type Theme, themeFor, toneColor } from "./styles.js";

/**
 * Graphviz DOT exporter — the pipe-it-anywhere format (`dot -Tpng`, and the
 * long tail of tooling that speaks DOT).
 *
 * DOT carries no positions, so Graphviz does its own layout and `needsLayout`
 * is false; Mermaid, not draw.io, is the closest sibling. Containment becomes
 * `subgraph cluster_*`, which is the one Graphviz construct that draws a box
 * around its members.
 */

/**
 * DOT ids are quoted, so any string is legal — but readable ids make the
 * output diffable and debuggable, and clusters *must* be named `cluster_…` to
 * be drawn as boxes. Same sanitize-and-disambiguate scheme as Mermaid.
 */
function dotIds(nodes: readonly GraphNode[]): Map<string, string> {
  const used = new Map<string, number>();
  const byNode = new Map<string, string>();
  for (const node of nodes) {
    const base = node.id.replace(/[^A-Za-z0-9]/g, "_");
    const seen = used.get(base);
    if (seen === undefined) {
      used.set(base, 1);
      byNode.set(node.id, base);
    } else {
      used.set(base, seen + 1);
      byNode.set(node.id, `${base}_${seen + 1}`);
    }
  }
  return byNode;
}

/** DOT string literals escape backslashes and quotes, in that order. */
function quote(text: string): string {
  return `"${text.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function attributes(pairs: ReadonlyArray<readonly [string, string]>): string {
  return pairs.map(([key, value]) => `${key}=${value}`).join(", ");
}

/** Node shape per kind, so a call graph reads without consulting a legend. */
function shape(node: GraphNode): string {
  if (node.external === true) {
    return "ellipse";
  }
  switch (node.kind) {
    case "function":
    case "method":
      // Graphviz's stadium equivalent — matches Mermaid's `([…])`.
      return "box";
    case "module":
    case "folder":
      return "folder";
    case "interface":
    case "enum":
      return "note";
    case "variable":
      return "ellipse";
    default:
      return "box";
  }
}

function nodeAttributes(node: GraphNode, theme: Theme): string {
  const style = theme.kinds[node.kind];
  const rounded = node.kind === "function" || node.kind === "method";
  const styles = [
    rounded ? "rounded" : "",
    "filled",
    node.external === true ? "dashed" : "",
  ].filter((value) => value !== "");
  return attributes([
    ["label", quote(displayLabel(node))],
    ["shape", quote(shape(node))],
    ["style", quote(styles.join(","))],
    ["fillcolor", quote(node.external === true ? theme.background : style.fill)],
    ["color", quote(style.stroke)],
    ["fontcolor", quote(theme.text)],
  ]);
}

/** The same label vocabulary the Mermaid exporter uses, for the same reasons. */
function edgeLabel(edge: GraphEdge): string {
  const parts: string[] = [];
  if (edge.kind === "extends" || edge.kind === "implements") {
    parts.push(edge.kind);
  }
  if (edge.kind === "imports" && edge.typeOnly === true) {
    parts.push("type");
  }
  if (edge.confidence === "low") {
    parts.push("?");
  }
  if (edge.count !== undefined) {
    parts.push(`${edge.count}×`);
  }
  return parts.join(" ");
}

function edgeAttributes(edge: GraphEdge, theme: Theme): string {
  const { tone, width, dash } = edgeEmphasis(edge);
  const label = edgeLabel(edge);
  const pairs: Array<readonly [string, string]> = [
    ["color", quote(toneColor(tone, theme))],
    ["penwidth", quote(String(width))],
  ];
  if (dash) {
    // A heuristic edge, a type-only import or an `implements` must never read
    // as a hard fact — dashed here, as in every other exporter.
    pairs.push(["style", quote("dashed")]);
  }
  if (tone === "heritage") {
    pairs.push(["arrowhead", quote("empty")]);
  }
  if (label !== "") {
    pairs.push(["label", quote(label)], ["fontcolor", quote(theme.text)]);
  }
  return attributes(pairs);
}

function graphToDot(graph: SemanticGraph, options?: ExportOptions): string {
  const theme = themeFor(options?.theme);
  const ids = dotIds(graph.nodes);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const children = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.kind !== "contains") {
      continue;
    }
    const list = children.get(edge.from) ?? [];
    list.push(edge.to);
    children.set(edge.from, list);
    hasParent.add(edge.to);
  }

  const lines: string[] = [
    "digraph slop {",
    `  rankdir=${options?.direction === "TD" ? "TB" : "LR"};`,
    `  bgcolor=${quote(theme.background)};`,
    `  node [fontname="Helvetica", fontsize=11];`,
    `  edge [fontname="Helvetica", fontsize=9];`,
  ];

  const renderNode = (node: GraphNode, indent: string): void => {
    const id = ids.get(node.id) ?? node.id;
    const childIds = children.get(node.id) ?? [];
    if (childIds.length === 0) {
      lines.push(`${indent}${id} [${nodeAttributes(node, theme)}];`);
      return;
    }
    // Only `cluster_`-prefixed subgraphs are drawn as a box around members.
    lines.push(`${indent}subgraph cluster_${id} {`);
    lines.push(`${indent}  label=${quote(displayLabel(node))};`);
    lines.push(`${indent}  style=${quote("rounded")};`);
    lines.push(`${indent}  color=${quote(theme.containerStroke)};`);
    lines.push(`${indent}  bgcolor=${quote(theme.containerFill)};`);
    lines.push(`${indent}  fontcolor=${quote(theme.text)};`);
    for (const childId of childIds) {
      const child = nodeById.get(childId);
      if (child !== undefined) {
        renderNode(child, `${indent}  `);
      }
    }
    lines.push(`${indent}}`);
  };
  for (const node of graph.nodes) {
    if (!hasParent.has(node.id)) {
      renderNode(node, "  ");
    }
  }

  for (const edge of graph.edges) {
    if (edge.kind === "contains") {
      continue;
    }
    const from = ids.get(edge.from);
    const to = ids.get(edge.to);
    if (from === undefined || to === undefined) {
      continue;
    }
    lines.push(`  ${from} -> ${to} [${edgeAttributes(edge, theme)}];`);
  }

  lines.push("}");
  return `${lines.join("\n")}\n`;
}

export const dotExporter: Exporter = {
  id: "dot",
  displayName: "Graphviz DOT",
  fileExtension: ".dot",
  needsLayout: false,
  export(graph, options) {
    return graphToDot(graph, options);
  },
};
