import type { ELK, ElkExtendedEdge, ElkNode } from "elkjs";
import ElkModule from "elkjs";
import type { GraphNode, SemanticGraph } from "../ir/types.js";
import { displayLabel } from "./label.js";

// elkjs ships CJS whose module.exports IS the constructor, while its .d.ts
// declares an ESM default export — under Node16 resolution the import arrives
// typed as the module namespace. Normalize once so both Node and bundlers work.
type ElkConstructor = new () => ELK;
const ElkClass: ElkConstructor =
  typeof ElkModule === "function"
    ? (ElkModule as unknown as ElkConstructor)
    : (ElkModule as { default: ElkConstructor }).default;

/**
 * Shared layout module (decision D9: elkjs layered). The webview and the
 * position-dependent exporters (draw.io, SVG) all consume this one result,
 * so what you export is what you saw. Pure computation — no DOM, no
 * filesystem — and deterministic: same graph, same coordinates.
 */

export interface LayoutPoint {
  x: number;
  y: number;
}

export interface LayoutNode {
  id: string;
  /** Absolute coordinates (top-left corner). */
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  /** True when the node renders as a container around its children. */
  container: boolean;
}

export interface LayoutEdge {
  id: string;
  /** Absolute polyline from source to target, bend points included. */
  points: LayoutPoint[];
}

export interface GraphLayout {
  width: number;
  height: number;
  nodes: LayoutNode[];
  edges: LayoutEdge[];
}

export interface LayoutGraphOptions {
  direction?: "RIGHT" | "DOWN";
}

/** Deterministic sizing: label length and kind, never canvas measurement. */
const CHARACTER_WIDTH = 7.5;
const LEAF_HEIGHT = 32;
const LEAF_MIN_WIDTH = 72;
const LABEL_PADDING = 28;
const CONTAINER_PADDING = "[top=40,left=16,bottom=16,right=16]";

function leafSize(node: GraphNode): { width: number; height: number } {
  const label = displayLabel(node);
  return {
    width: Math.max(LEAF_MIN_WIDTH, Math.round(label.length * CHARACTER_WIDTH) + LABEL_PADDING),
    height: LEAF_HEIGHT,
  };
}

export async function layoutGraph(
  graph: SemanticGraph,
  options: LayoutGraphOptions = {},
): Promise<GraphLayout> {
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
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));

  const toElkNode = (node: GraphNode): ElkNode => {
    const childIds = children.get(node.id) ?? [];
    if (childIds.length === 0) {
      return { id: node.id, ...leafSize(node) };
    }
    return {
      id: node.id,
      layoutOptions: { "elk.padding": CONTAINER_PADDING },
      children: childIds
        .map((id) => nodeById.get(id))
        .filter((child): child is GraphNode => child !== undefined)
        .map(toElkNode),
    };
  };

  const roots = graph.nodes.filter((node) => !hasParent.has(node.id));
  const elkEdges: ElkExtendedEdge[] = graph.edges
    .filter((edge) => edge.kind !== "contains" && edge.from !== edge.to)
    .map((edge) => ({ id: edge.id, sources: [edge.from], targets: [edge.to] }));

  const rootGraph: ElkNode = {
    id: "__root__",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": options.direction ?? "RIGHT",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.spacing.nodeNode": "24",
      "elk.layered.spacing.nodeNodeBetweenLayers": "40",
      "elk.spacing.componentComponent": "48",
      "elk.edgeRouting": "ORTHOGONAL",
    },
    children: roots.map(toElkNode),
    edges: elkEdges,
  };

  const laidOut = await new ElkClass().layout(rootGraph);

  const nodes: LayoutNode[] = [];
  const collect = (elkNode: ElkNode, offsetX: number, offsetY: number): void => {
    for (const child of elkNode.children ?? []) {
      const x = offsetX + (child.x ?? 0);
      const y = offsetY + (child.y ?? 0);
      const source = nodeById.get(child.id);
      nodes.push({
        id: child.id,
        x,
        y,
        width: child.width ?? 0,
        height: child.height ?? 0,
        label: source === undefined ? child.id : displayLabel(source),
        container: (child.children?.length ?? 0) > 0,
      });
      collect(child, x, y);
    }
  };
  collect(laidOut, 0, 0);
  nodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const edges: LayoutEdge[] = [];
  for (const edge of laidOut.edges ?? []) {
    const section = edge.sections?.[0];
    if (section === undefined) {
      continue;
    }
    edges.push({
      id: edge.id,
      points: [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map(
        (point) => ({ x: point.x, y: point.y }),
      ),
    });
  }
  edges.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return {
    width: laidOut.width ?? 0,
    height: laidOut.height ?? 0,
    nodes,
    edges,
  };
}
