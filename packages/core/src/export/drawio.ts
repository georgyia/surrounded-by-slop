import type { GraphEdge, NodeKind } from "../ir/types.js";
import { type Exporter, requiredLayout } from "./exporter.js";

/**
 * draw.io / diagrams.net exporter: uncompressed mxGraph XML, pretty-printed,
 * fixed attribute order, no timestamps — open it, edit it, diff it in Git.
 * Positions come from the shared layout, so the file matches what the editor
 * rendered. Children use draw.io's parent-relative coordinates.
 */

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Deterministic, compact coordinates (elk emits long floats). */
function coordinate(value: number): string {
  return String(Math.round(value * 100) / 100);
}

const CONTAINER_STYLE =
  "rounded=1;whiteSpace=wrap;html=1;verticalAlign=top;align=left;spacingLeft=8;fontStyle=1;" +
  "fillColor=#F5F5F5;strokeColor=#666666;container=1;collapsible=1;";

const LEAF_STYLES: Record<NodeKind, string> = {
  module: "rounded=1;whiteSpace=wrap;html=1;fillColor=#EAEEF2;strokeColor=#8C959F;",
  namespace: "rounded=1;whiteSpace=wrap;html=1;fillColor=#DAE8FC;strokeColor=#6C8EBF;",
  class: "rounded=1;whiteSpace=wrap;html=1;fillColor=#DAE8FC;strokeColor=#6C8EBF;",
  interface: "rounded=1;whiteSpace=wrap;html=1;fillColor=#E1D5E7;strokeColor=#9673A6;",
  enum: "rounded=1;whiteSpace=wrap;html=1;fillColor=#FFE6CC;strokeColor=#D79B00;",
  function: "rounded=1;whiteSpace=wrap;html=1;fillColor=#D5E8D4;strokeColor=#82B366;",
  method: "rounded=1;whiteSpace=wrap;html=1;fillColor=#D5E8D4;strokeColor=#82B366;",
  variable: "rounded=1;whiteSpace=wrap;html=1;fillColor=#FFF2CC;strokeColor=#D6B656;",
  folder: "rounded=1;whiteSpace=wrap;html=1;fillColor=#F5F5F5;strokeColor=#666666;",
};

const EXTERNAL_STYLE =
  "rounded=1;whiteSpace=wrap;html=1;dashed=1;fillColor=none;strokeColor=#8C959F;";

function edgeStyle(edge: GraphEdge): string {
  const base = "edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;";
  if (edge.kind === "extends") {
    return `${base}endArrow=block;endFill=0;endSize=10;strokeColor=#9673A6;`;
  }
  if (edge.kind === "implements") {
    return `${base}endArrow=block;endFill=0;endSize=10;dashed=1;strokeColor=#9673A6;`;
  }
  if (edge.kind === "imports") {
    return `${base}endArrow=open;dashed=1;strokeColor=#6C8EBF;`;
  }
  if (edge.confidence === "low") {
    return `${base}endArrow=classic;dashed=1;strokeColor=#999999;`;
  }
  return `${base}endArrow=classic;strokeColor=#4D4D4D;`;
}

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

export const drawioExporter: Exporter = {
  id: "drawio",
  displayName: "draw.io",
  fileExtension: ".drawio",
  needsLayout: true,
  export(graph, options) {
    const layout = requiredLayout(this, options);
    const boxById = new Map(layout.nodes.map((node) => [node.id, node]));
    const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
    const parentById = new Map<string, string>();
    for (const edge of graph.edges) {
      if (edge.kind === "contains") {
        parentById.set(edge.to, edge.from);
      }
    }

    const lines: string[] = [
      '<mxfile host="surrounded-by-slop">',
      '  <diagram id="code-map" name="Code Map">',
      '    <mxGraphModel dx="1000" dy="600" grid="0" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" math="0" shadow="0">',
      "      <root>",
      '        <mxCell id="0" />',
      '        <mxCell id="1" parent="0" />',
    ];

    // Vertices in canonical layout order; geometry relative to the parent box.
    for (const box of layout.nodes) {
      const node = nodeById.get(box.id);
      if (node === undefined) {
        continue;
      }
      const parentId = parentById.get(box.id);
      const parentBox = parentId === undefined ? undefined : boxById.get(parentId);
      const x = box.x - (parentBox?.x ?? 0);
      const y = box.y - (parentBox?.y ?? 0);
      const style = box.container
        ? CONTAINER_STYLE
        : node.external === true
          ? EXTERNAL_STYLE
          : LEAF_STYLES[node.kind];
      lines.push(
        `        <mxCell id="${escapeXml(box.id)}" value="${escapeXml(box.label)}" style="${style}" vertex="1" parent="${escapeXml(parentId ?? "1")}">`,
        `          <mxGeometry x="${coordinate(x)}" y="${coordinate(y)}" width="${coordinate(box.width)}" height="${coordinate(box.height)}" as="geometry" />`,
        "        </mxCell>",
      );
    }

    // Edges in canonical graph order; bend points from the layout routes.
    const routeById = new Map(layout.edges.map((edge) => [edge.id, edge]));
    for (const edge of graph.edges) {
      if (edge.kind === "contains") {
        continue;
      }
      const label = edgeLabel(edge);
      lines.push(
        `        <mxCell id="${escapeXml(edge.id)}" value="${escapeXml(label)}" style="${edgeStyle(edge)}" edge="1" parent="1" source="${escapeXml(edge.from)}" target="${escapeXml(edge.to)}">`,
      );
      const bends = routeById.get(edge.id)?.points.slice(1, -1) ?? [];
      if (bends.length === 0) {
        lines.push('          <mxGeometry relative="1" as="geometry" />');
      } else {
        lines.push(
          '          <mxGeometry relative="1" as="geometry">',
          '            <Array as="points">',
        );
        for (const point of bends) {
          lines.push(
            `              <mxPoint x="${coordinate(point.x)}" y="${coordinate(point.y)}" />`,
          );
        }
        lines.push("            </Array>", "          </mxGeometry>");
      }
      lines.push("        </mxCell>");
    }

    lines.push("      </root>", "    </mxGraphModel>", "  </diagram>", "</mxfile>");
    return `${lines.join("\n")}\n`;
  },
};
