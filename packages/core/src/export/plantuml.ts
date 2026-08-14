import type { GraphEdge, GraphNode, SemanticGraph } from "../ir/types.js";
import { edgeEmphasis } from "../layout/edgeEmphasis.js";
import { displayLabel } from "../layout/label.js";
import type { Exporter, ExportOptions } from "./exporter.js";
import { type Theme, themeFor, toneColor } from "./styles.js";

/**
 * PlantUML exporter, for teams who already live in PlantUML.
 *
 * Two targets, split by `options.view` exactly as the Mermaid exporter splits
 * them: `graph` renders the call/import structure as `rectangle`s inside
 * `package` blocks, and `class` renders a UML class diagram of the
 * classes/interfaces/enums with their methods. PlantUML does its own layout,
 * so `needsLayout` is false.
 */

/**
 * PlantUML aliases are bare identifiers, so they get the same sanitize-and-
 * disambiguate treatment as Mermaid and DOT. Display text goes in the quoted
 * label, never in the alias — a rename then changes one line, not fifty.
 */
function plantumlIds(nodes: readonly GraphNode[]): Map<string, string> {
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

/**
 * PlantUML has no escape for a double quote inside a quoted label, so the only
 * safe move is to substitute a typographic quote — visually identical, and it
 * cannot terminate the string early.
 */
function label(text: string): string {
  return text.replaceAll('"', "”");
}

/** UML stereotypes carry the kind that `rectangle` alone cannot express. */
function stereotype(node: GraphNode): string {
  if (node.external === true) {
    return " <<external>>";
  }
  switch (node.kind) {
    case "function":
    case "method":
      return " <<function>>";
    case "module":
      return " <<module>>";
    case "folder":
      return " <<folder>>";
    case "interface":
      return " <<interface>>";
    case "enum":
      return " <<enumeration>>";
    case "variable":
      return " <<variable>>";
    default:
      return "";
  }
}

/** The same label vocabulary every other exporter uses, for the same reasons. */
function edgeNote(edge: GraphEdge): string {
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

/**
 * PlantUML encodes line style in the arrow itself: `-->` solid, `..>` dotted,
 * and `[#colour]` carries the tone. Dashed edges stay dotted so a heuristic or
 * type-only relationship never reads as a fact.
 */
function arrow(edge: GraphEdge, theme: Theme): string {
  const { tone, dash } = edgeEmphasis(edge);
  const color = toneColor(tone, theme);
  return dash ? `.[${color}].>` : `-[${color}]->`;
}

function componentDiagram(graph: SemanticGraph, options?: ExportOptions): string {
  const theme = themeFor(options?.theme);
  const ids = plantumlIds(graph.nodes);
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

  const lines: string[] = ["@startuml"];
  // `left to right direction` is PlantUML's LR; the default is top-down.
  if (options?.direction !== "TD") {
    lines.push("left to right direction");
  }

  const renderNode = (node: GraphNode, indent: string): void => {
    const id = ids.get(node.id) ?? node.id;
    const childIds = children.get(node.id) ?? [];
    const text = label(displayLabel(node));
    if (childIds.length === 0) {
      lines.push(`${indent}rectangle "${text}" as ${id}${stereotype(node)}`);
      return;
    }
    lines.push(`${indent}package "${text}" as ${id}${stereotype(node)} {`);
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
      renderNode(node, "");
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
    const note = edgeNote(edge);
    const link = `${from} ${arrow(edge, theme)} ${to}`;
    lines.push(note === "" ? link : `${link} : ${label(note)}`);
  }

  lines.push("@enduml");
  return `${lines.join("\n")}\n`;
}

/** `(value: number): number` → PlantUML's `+name(value: number) : number`. */
function memberSignature(name: string, signature: string | undefined): string {
  const visibility = name.startsWith("#") ? "-" : "+";
  const cleanName = name.startsWith("#") ? name.slice(1) : name;
  const generic = signature ?? "()";
  const splitAt = generic.lastIndexOf("): ");
  const args = splitAt === -1 ? generic : generic.slice(0, splitAt + 1);
  const returns = splitAt === -1 ? "" : ` : ${generic.slice(splitAt + 3)}`;
  return `${visibility}${cleanName}${args}${returns}`;
}

function classDiagram(graph: SemanticGraph): string {
  const ids = plantumlIds(graph.nodes);
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

  const lines: string[] = ["@startuml"];
  for (const node of graph.nodes) {
    if (node.kind !== "class" && node.kind !== "interface" && node.kind !== "enum") {
      continue;
    }
    const id = ids.get(node.id) ?? node.id;
    // PlantUML has first-class keywords for these — no stereotype needed.
    const keyword = node.kind === "class" ? "class" : node.kind;
    const memberList = members.get(node.id) ?? [];
    const header = `${keyword} "${label(node.name)}" as ${id}`;
    if (memberList.length === 0) {
      lines.push(header);
      continue;
    }
    lines.push(`${header} {`);
    for (const member of memberList) {
      lines.push(`  ${label(memberSignature(member.name, member.signature))}`);
    }
    lines.push("}");
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
    // UML: solid hollow triangle for generalization, dotted for realization.
    lines.push(edge.kind === "extends" ? `${to} <|-- ${from}` : `${to} <|.. ${from}`);
  }
  lines.push("@enduml");
  return `${lines.join("\n")}\n`;
}

export const plantumlExporter: Exporter = {
  id: "plantuml",
  displayName: "PlantUML",
  fileExtension: ".puml",
  needsLayout: false,
  export(graph, options) {
    return options?.view === "class" ? classDiagram(graph) : componentDiagram(graph, options);
  },
};
