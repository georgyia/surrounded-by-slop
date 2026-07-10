import type { GraphEdge, NodeKind } from "../ir/types.js";
import { type Exporter, requiredLayout } from "./exporter.js";

/**
 * Standalone SVG exporter: embedded styles, no external references, light and
 * dark themes. Positions come from the shared layout; output is deterministic
 * text you can paste into docs, wikis or slides.
 */

interface KindStyle {
  fill: string;
  stroke: string;
}

interface Theme {
  background: string;
  text: string;
  containerFill: string;
  containerStroke: string;
  edge: string;
  edgeLow: string;
  heritage: string;
  fillOpacity: string;
  kinds: Record<NodeKind, KindStyle>;
}

const LIGHT: Theme = {
  background: "#ffffff",
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
  background: "#0b0f17",
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
    return { stroke: theme.heritage, dash: edge.kind === "implements", marker: "hollow" };
  }
  if (edge.confidence === "low") {
    return { stroke: theme.edgeLow, dash: true, marker: "solid" };
  }
  return { stroke: theme.edge, dash: edge.kind === "imports", marker: "solid" };
}

export const svgExporter: Exporter = {
  id: "svg",
  displayName: "SVG",
  fileExtension: ".svg",
  needsLayout: true,
  export(graph, options) {
    const layout = requiredLayout(this, options);
    const theme = options?.theme === "dark" ? DARK : LIGHT;
    const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
    const margin = 16;
    const width = coordinate(layout.width + margin * 2);
    const height = coordinate(layout.height + margin * 2);

    const lines: string[] = [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="12">`,
      "  <defs>",
      `    <marker id="arrow-solid" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9 z" fill="${theme.edge}" /></marker>`,
      `    <marker id="arrow-low" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9 z" fill="${theme.edgeLow}" /></marker>`,
      `    <marker id="arrow-hollow" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="10" markerHeight="10" orient="auto-start-reverse"><path d="M 1 1 L 11 6 L 1 11 z" fill="${theme.background}" stroke="${theme.heritage}" /></marker>`,
      "  </defs>",
      `  <rect width="100%" height="100%" fill="${theme.background}" />`,
      `  <g transform="translate(${margin},${margin})">`,
    ];

    // Containers first (biggest area at the back), then edges, then leaves.
    const containers = layout.nodes
      .filter((node) => node.container)
      .sort((a, b) => b.width * b.height - a.width * a.height || (a.id < b.id ? -1 : 1));
    for (const box of containers) {
      lines.push(
        `    <rect x="${coordinate(box.x)}" y="${coordinate(box.y)}" width="${coordinate(box.width)}" height="${coordinate(box.height)}" rx="8" fill="${theme.containerFill}" stroke="${theme.containerStroke}" />`,
        `    <text x="${coordinate(box.x + 10)}" y="${coordinate(box.y + 22)}" fill="${theme.text}" font-weight="600">${escapeXml(box.label)}</text>`,
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
      const { stroke, dash, marker } = edgeStroke(edge, theme);
      const markerId =
        marker === "hollow"
          ? "arrow-hollow"
          : edge.confidence === "low"
            ? "arrow-low"
            : "arrow-solid";
      const points = route.points.map((p) => `${coordinate(p.x)},${coordinate(p.y)}`).join(" ");
      lines.push(
        `    <polyline points="${points}" fill="none" stroke="${stroke}" stroke-width="1.5"${dash ? ' stroke-dasharray="6 5"' : ""} marker-end="url(#${markerId})" />`,
      );
    }

    for (const box of layout.nodes) {
      if (box.container) {
        continue;
      }
      const node = nodeById.get(box.id);
      const style = node === undefined ? theme.kinds.module : theme.kinds[node.kind];
      const dashed = node?.external === true ? ' stroke-dasharray="4 3"' : "";
      lines.push(
        `    <rect x="${coordinate(box.x)}" y="${coordinate(box.y)}" width="${coordinate(box.width)}" height="${coordinate(box.height)}" rx="6" fill="${style.fill}" fill-opacity="${theme.fillOpacity}" stroke="${style.stroke}"${dashed} />`,
        `    <text x="${coordinate(box.x + box.width / 2)}" y="${coordinate(box.y + box.height / 2 + 4)}" text-anchor="middle" fill="${theme.text}">${escapeXml(box.label)}</text>`,
      );
    }

    lines.push("  </g>", "</svg>");
    return `${lines.join("\n")}\n`;
  },
};
