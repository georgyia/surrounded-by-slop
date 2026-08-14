import type { GraphEdge } from "../ir/types.js";
import { type EdgeTone, edgeEmphasis } from "../layout/edgeEmphasis.js";
import { type Exporter, requiredLayout } from "./exporter.js";
import { type Theme, themeFor, toneColor } from "./styles.js";

/**
 * Standalone SVG exporter: embedded styles, no external references, light and
 * dark themes. Positions come from the shared layout; output is deterministic
 * text you can paste into docs, wikis or slides. The palette is shared with
 * every other exporter (`styles.ts`).
 */

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

const TONE_MARKERS: Record<EdgeTone, string> = {
  normal: "arrow-solid",
  muted: "arrow-low",
  heritage: "arrow-hollow",
  cycle: "arrow-cycle",
};

/** Shares the emphasis rules with the webview so exports match what you saw. */
function edgeStroke(
  edge: GraphEdge,
  theme: Theme,
): { stroke: string; dash: boolean; marker: string; width: number } {
  const { tone, width, dash } = edgeEmphasis(edge);
  return { stroke: toneColor(tone, theme), dash, marker: TONE_MARKERS[tone], width };
}

export const svgExporter: Exporter = {
  id: "svg",
  displayName: "SVG",
  fileExtension: ".svg",
  needsLayout: true,
  export(graph, options) {
    const layout = requiredLayout(this, options);
    const theme = themeFor(options?.theme);
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
      `    <marker id="arrow-cycle" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9 z" fill="${theme.cycle}" /></marker>`,
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
      const { stroke, dash, marker, width } = edgeStroke(edge, theme);
      const points = route.points.map((p) => `${coordinate(p.x)},${coordinate(p.y)}`).join(" ");
      lines.push(
        `    <polyline points="${points}" fill="none" stroke="${stroke}" stroke-width="${width}"${dash ? ' stroke-dasharray="6 5"' : ""} marker-end="url(#${marker})" />`,
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
