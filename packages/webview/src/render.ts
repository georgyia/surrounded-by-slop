import type { GraphEdge, GraphLayout, NodeKind, SemanticGraph } from "@surrounded-by-slop/core";
import type { ColorTheme } from "./protocol.js";

/**
 * The webview's interactive SVG renderer (decision D10 — a custom minimal
 * renderer, no graph framework). It shares the layout and the visual language
 * of the core's static SVG exporter, but adds what an editor view needs: every
 * node carries `data-node-id` for click-to-source, and everything lives inside
 * one `.slop-viewport` group the host pans and zooms by setting its transform.
 *
 * Pure and string-valued so it can be unit-tested without a DOM; `main.ts` drops
 * the result into the panel with `innerHTML` (SVG only, no scripts — CSP-safe).
 */

export interface KindStyle {
  readonly fill: string;
  readonly stroke: string;
}

export interface Theme {
  readonly text: string;
  readonly containerFill: string;
  readonly containerStroke: string;
  readonly edge: string;
  readonly edgeLow: string;
  readonly heritage: string;
  readonly fillOpacity: string;
  readonly kinds: Readonly<Record<NodeKind, KindStyle>>;
}

const LIGHT: Theme = {
  text: "#1f2328",
  containerFill: "#f6f8fa",
  containerStroke: "#d0d7de",
  edge: "#57606a",
  edgeLow: "#a8b1ba",
  heritage: "#8250df",
  fillOpacity: "1",
  kinds: {
    module: { fill: "#eaeef2", stroke: "#8c959f" },
    namespace: { fill: "#ddf4ff", stroke: "#54aeff" },
    class: { fill: "#ddf4ff", stroke: "#54aeff" },
    interface: { fill: "#fbefff", stroke: "#c297ff" },
    enum: { fill: "#fff1e5", stroke: "#f0883e" },
    function: { fill: "#dafbe1", stroke: "#4ac26b" },
    method: { fill: "#dafbe1", stroke: "#4ac26b" },
    variable: { fill: "#fff8c5", stroke: "#d4a72c" },
    folder: { fill: "#f6f8fa", stroke: "#8c959f" },
  },
};

const DARK: Theme = {
  text: "#e6edf3",
  containerFill: "#10151f",
  containerStroke: "#21262d",
  edge: "#8b949e",
  edgeLow: "#484f58",
  heritage: "#bc8cff",
  fillOpacity: "0.13",
  kinds: {
    module: { fill: "#8b949e", stroke: "#8b949e" },
    namespace: { fill: "#58a6ff", stroke: "#58a6ff" },
    class: { fill: "#58a6ff", stroke: "#58a6ff" },
    interface: { fill: "#bc8cff", stroke: "#bc8cff" },
    enum: { fill: "#d29922", stroke: "#d29922" },
    function: { fill: "#3fb950", stroke: "#3fb950" },
    method: { fill: "#3fb950", stroke: "#3fb950" },
    variable: { fill: "#d29922", stroke: "#d29922" },
    folder: { fill: "#8b949e", stroke: "#8b949e" },
  },
};

/** The palette a theme draws with — shared so the legend swatches match exactly. */
export function paletteFor(theme: ColorTheme): Theme {
  return theme === "dark" ? DARK : LIGHT;
}

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function coordinate(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function edgeStroke(
  edge: GraphEdge,
  theme: Theme,
): { stroke: string; dash: boolean; marker: string } {
  if (edge.kind === "extends" || edge.kind === "implements") {
    return { stroke: theme.heritage, dash: edge.kind === "implements", marker: "arrow-hollow" };
  }
  if (edge.confidence === "low") {
    return { stroke: theme.edgeLow, dash: true, marker: "arrow-low" };
  }
  return { stroke: theme.edge, dash: edge.kind === "imports", marker: "arrow-solid" };
}

/** Render `graph` (positioned by `layout`) as an interactive SVG document string. */
export function renderDiagram(
  graph: SemanticGraph,
  layout: GraphLayout,
  theme: ColorTheme,
  expandableIds: Iterable<string> = [],
): string {
  const palette = paletteFor(theme);
  const expandable = new Set(expandableIds);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const width = coordinate(layout.width);
  const height = coordinate(layout.height);

  const lines: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" class="slop-diagram" width="100%" height="100%" font-family="var(--vscode-editor-font-family, ui-monospace, monospace)" font-size="12">`,
    "  <defs>",
    `    <marker id="arrow-solid" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9 z" fill="${palette.edge}" /></marker>`,
    `    <marker id="arrow-low" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9 z" fill="${palette.edgeLow}" /></marker>`,
    `    <marker id="arrow-hollow" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="10" markerHeight="10" orient="auto-start-reverse"><path d="M 1 1 L 11 6 L 1 11 z" fill="none" stroke="${palette.heritage}" /></marker>`,
    "  </defs>",
    `  <g class="slop-viewport" data-content-width="${width}" data-content-height="${height}">`,
  ];

  // Containers behind everything, biggest first so children sit on top.
  const containers = layout.nodes
    .filter((node) => node.container)
    .sort((a, b) => b.width * b.height - a.width * a.height || (a.id < b.id ? -1 : 1));
  for (const box of containers) {
    // A container is expanded — clicking its frame collapses it back (SBS-062).
    lines.push(
      `    <g class="slop-container" data-node-id="${escapeXml(box.id)}" data-expandable="collapse" role="button" tabindex="0" aria-label="${escapeXml(box.label)} (expanded)">`,
      `      <rect x="${coordinate(box.x)}" y="${coordinate(box.y)}" width="${coordinate(box.width)}" height="${coordinate(box.height)}" rx="8" fill="${palette.containerFill}" stroke="${palette.containerStroke}" />`,
      `      <text x="${coordinate(box.x + 10)}" y="${coordinate(box.y + 22)}" fill="${palette.text}" font-weight="600">${escapeXml(box.label)}</text>`,
      `      <text class="slop-caret" x="${coordinate(box.x + box.width - 16)}" y="${coordinate(box.y + 22)}" fill="${palette.text}" aria-hidden="true">▾</text>`,
      "    </g>",
    );
  }

  const routeById = new Map(layout.edges.map((edge) => [edge.id, edge]));
  for (const edge of graph.edges) {
    if (edge.kind === "contains") {
      continue;
    }
    const route = routeById.get(edge.id);
    if (route === undefined) {
      continue;
    }
    const { stroke, dash, marker } = edgeStroke(edge, palette);
    const points = route.points
      .map((point) => `${coordinate(point.x)},${coordinate(point.y)}`)
      .join(" ");
    lines.push(
      `    <polyline points="${points}" fill="none" stroke="${stroke}" stroke-width="1.5"${dash ? ' stroke-dasharray="6 5"' : ""} marker-end="url(#${marker})" />`,
    );
  }

  // Leaf nodes on top, each a click target that carries its graph id.
  for (const box of layout.nodes) {
    if (box.container) {
      continue;
    }
    const node = nodeById.get(box.id);
    const style = node === undefined ? palette.kinds.module : palette.kinds[node.kind];
    const dashed = node?.external === true ? ' stroke-dasharray="4 3"' : "";
    // A collapsed container hiding members shows a ▸ and clicks open to expand.
    const canExpand = expandable.has(box.id);
    const expandAttr = canExpand ? ' data-expandable="expand"' : "";
    const label = canExpand ? `${box.label} (collapsed)` : box.label;
    lines.push(
      `    <g class="slop-node" data-node-id="${escapeXml(box.id)}"${expandAttr} role="button" tabindex="0" aria-label="${escapeXml(label)}">`,
      `      <rect x="${coordinate(box.x)}" y="${coordinate(box.y)}" width="${coordinate(box.width)}" height="${coordinate(box.height)}" rx="6" fill="${style.fill}" fill-opacity="${palette.fillOpacity}" stroke="${style.stroke}"${dashed} />`,
      `      <text x="${coordinate(box.x + box.width / 2)}" y="${coordinate(box.y + box.height / 2 + 4)}" text-anchor="middle" fill="${palette.text}">${escapeXml(box.label)}</text>`,
      ...(canExpand
        ? [
            `      <text class="slop-caret" x="${coordinate(box.x + box.width - 12)}" y="${coordinate(box.y + 12)}" fill="${palette.text}" aria-hidden="true">▸</text>`,
          ]
        : []),
      "    </g>",
    );
  }

  lines.push("  </g>", "</svg>");
  return `${lines.join("\n")}\n`;
}
