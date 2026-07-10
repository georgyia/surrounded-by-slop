import type { GraphEdge, GraphNode, SemanticGraph } from "../ir/types.js";
import { displayLabel } from "../layout/label.js";
import type { Exporter, ExportOptions } from "./exporter.js";

/**
 * Mermaid exporter — the paste-into-a-PR format. Two views:
 * `graph` (flowchart with containment as nested subgraphs) and
 * `class` (classDiagram of classes/interfaces/enums with method members).
 * Ids are sanitized per node id, so a rename changes one line, not fifty.
 */

function mermaidIds(nodes: readonly GraphNode[]): Map<string, string> {
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

function escapeLabel(text: string): string {
  return text.replaceAll('"', "#quot;");
}

function shape(node: GraphNode, label: string): string {
  const escaped = escapeLabel(label);
  if (node.kind === "function" || node.kind === "method") {
    return `(["${escaped}"])`;
  }
  if (node.external === true) {
    return `(("${escaped}"))`;
  }
  if (node.kind === "module") {
    return `[["${escaped}"]]`;
  }
  return `["${escaped}"]`;
}

function edgeArrow(edge: GraphEdge): { arrow: string; label: string } {
  const labelParts: string[] = [];
  if (edge.kind === "extends" || edge.kind === "implements") {
    labelParts.push(edge.kind);
  }
  if (edge.kind === "imports" && edge.typeOnly === true) {
    labelParts.push("type");
  }
  if (edge.confidence === "low") {
    labelParts.push("?");
  }
  if (edge.count !== undefined) {
    labelParts.push(`${edge.count}×`);
  }
  const dotted = edge.kind === "imports" || edge.kind === "implements" || edge.confidence === "low";
  return { arrow: dotted ? "-.->" : "-->", label: labelParts.join(" ") };
}

function flowchart(graph: SemanticGraph, options?: ExportOptions): string {
  const ids = mermaidIds(graph.nodes);
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

  const lines: string[] = [`flowchart ${options?.direction === "TD" ? "TD" : "LR"}`];
  const renderNode = (node: GraphNode, indent: string): void => {
    const id = ids.get(node.id) ?? node.id;
    const childIds = children.get(node.id) ?? [];
    if (childIds.length === 0) {
      lines.push(`${indent}${id}${shape(node, displayLabel(node))}`);
      return;
    }
    lines.push(`${indent}subgraph ${id}["${escapeLabel(displayLabel(node))}"]`);
    for (const childId of childIds) {
      const child = nodeById.get(childId);
      if (child !== undefined) {
        renderNode(child, `${indent}  `);
      }
    }
    lines.push(`${indent}end`);
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
    const { arrow, label } = edgeArrow(edge);
    lines.push(
      label === ""
        ? `  ${from} ${arrow} ${to}`
        : `  ${from} ${arrow}|"${escapeLabel(label)}"| ${to}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

/** `(value: number): number` → members line-friendly `(value: number) number`. */
function memberSignature(name: string, signature: string | undefined): string {
  const visibility = name.startsWith("#") ? "-" : "+";
  const cleanName = name.startsWith("#") ? name.slice(1) : name;
  const generic = (signature ?? "()").replaceAll("<", "~").replaceAll(">", "~");
  const splitAt = generic.lastIndexOf("): ");
  const args = splitAt === -1 ? generic : generic.slice(0, splitAt + 1);
  const returns = splitAt === -1 ? "" : ` ${generic.slice(splitAt + 3)}`;
  return `${visibility}${cleanName}${args}${returns}`;
}

function classDiagram(graph: SemanticGraph): string {
  const ids = mermaidIds(graph.nodes);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const members = new Map<string, GraphNode[]>();
  for (const edge of graph.edges) {
    if (edge.kind !== "contains") {
      continue;
    }
    const child = nodeById.get(edge.to);
    if (child?.kind === "method") {
      const list = members.get(edge.from) ?? [];
      list.push(child);
      members.set(edge.from, list);
    }
  }

  const lines: string[] = ["classDiagram"];
  for (const node of graph.nodes) {
    if (node.kind !== "class" && node.kind !== "interface" && node.kind !== "enum") {
      continue;
    }
    const id = ids.get(node.id) ?? node.id;
    lines.push(`  class ${id}["${escapeLabel(node.name)}"] {`);
    if (node.kind === "interface") {
      lines.push("    <<interface>>");
    }
    if (node.kind === "enum") {
      lines.push("    <<enumeration>>");
    }
    for (const member of members.get(node.id) ?? []) {
      lines.push(`    ${memberSignature(member.name, member.signature)}`);
    }
    lines.push("  }");
  }
  for (const edge of graph.edges) {
    if (edge.kind !== "extends" && edge.kind !== "implements") {
      continue;
    }
    const from = ids.get(edge.from);
    const to = ids.get(edge.to);
    if (from === undefined || to === undefined) {
      continue;
    }
    lines.push(edge.kind === "extends" ? `  ${to} <|-- ${from}` : `  ${to} <|.. ${from}`);
  }
  return `${lines.join("\n")}\n`;
}

export const mermaidExporter: Exporter = {
  id: "mermaid",
  displayName: "Mermaid",
  fileExtension: ".mmd",
  needsLayout: false,
  export(graph, options) {
    return options?.view === "class" ? classDiagram(graph) : flowchart(graph, options);
  },
};
