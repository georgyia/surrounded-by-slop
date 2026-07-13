import {
  type CfgEdgeKind,
  type ControlFlowGraph,
  type GraphLayout,
  reachableCfgBlocks,
} from "@surrounded-by-slop/core";
import type { ColorTheme } from "./protocol.js";
import { paletteFor, type Theme } from "./render.js";

/**
 * The function-flowchart renderer (SBS-071). Same contract as `renderDiagram`
 * — a pure SVG string dropped into the viewport — but it draws the CFG's own
 * vocabulary: Start/End pills, statement blocks, condition-labeled branches,
 * dashed loop back-edges, and dotted exception/finally routes. The layout is
 * computed host-side from a synthetic one-node-per-block graph, so routes are
 * looked up by block pair.
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

interface FlowEdgeStyle {
  readonly stroke: string;
  readonly dash: string | undefined;
}

function edgeStyle(kind: CfgEdgeKind, palette: Theme): FlowEdgeStyle {
  switch (kind) {
    case "back":
      return { stroke: palette.heritage, dash: "6 5" };
    case "exception":
      return { stroke: palette.kinds.enum.stroke, dash: "3 3" };
    case "finally":
      return { stroke: palette.edgeLow, dash: "3 3" };
    default:
      return { stroke: palette.edge, dash: undefined };
  }
}

function edgeText(kind: CfgEdgeKind, label: string | undefined): string | undefined {
  switch (kind) {
    case "true":
    case "false":
      return kind;
    case "case":
      return label;
    case "exception":
      return "throws";
    case "finally":
      return "finally";
    default:
      return undefined;
  }
}

/** Render `flow` (positioned by `layout`, one box per block id) as an SVG string. */
export function renderFlowDiagram(
  flow: ControlFlowGraph,
  layout: GraphLayout,
  theme: ColorTheme,
): string {
  const palette = paletteFor(theme);
  const blockById = new Map(flow.blocks.map((block) => [block.id, block]));
  // Blocks with no path from entry are dead code — dim them and say so (SBS-073).
  const reachable = reachableCfgBlocks(flow);
  const width = coordinate(layout.width);
  const height = coordinate(layout.height);

  const lines: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" class="slop-diagram" width="100%" height="100%" font-family="var(--vscode-editor-font-family, ui-monospace, monospace)" font-size="12">`,
    "  <defs>",
    `    <marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9 z" fill="${palette.edge}" /></marker>`,
    `    <marker id="flow-arrow-back" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9 z" fill="${palette.heritage}" /></marker>`,
    `    <marker id="flow-arrow-soft" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9 z" fill="${palette.edgeLow}" /></marker>`,
    "  </defs>",
    `  <g class="slop-viewport" data-content-width="${width}" data-content-height="${height}">`,
  ];

  // Routes come from the synthetic layout, one per (from, to) block pair.
  const routeByPair = new Map(layout.edges.map((edge) => [edge.id, edge]));
  const routeFor = (from: string, to: string) =>
    routeByPair.get(`calls:${from}->${to}`) ?? routeByPair.get(`${from}->${to}`);

  // Parallel edges (an if with an empty arm yields true+false to one target)
  // share one route; draw a single line with the labels joined.
  const grouped = new Map<string, { kinds: CfgEdgeKind[]; labels: string[] }>();
  for (const edge of flow.edges) {
    const key = `${edge.from}->${edge.to}`;
    const group = grouped.get(key) ?? { kinds: [], labels: [] };
    group.kinds.push(edge.kind);
    const text = edgeText(edge.kind, edge.label);
    if (text !== undefined) {
      group.labels.push(text);
    }
    grouped.set(key, group);
  }

  for (const [pair, group] of grouped) {
    const [from, to] = pair.split("->") as [string, string];
    const route = routeFor(from, to);
    if (route === undefined) {
      continue;
    }
    // The strongest kind decides the line style: back > exception > finally > rest.
    const kind =
      group.kinds.find((candidate) => candidate === "back") ??
      group.kinds.find((candidate) => candidate === "exception") ??
      group.kinds.find((candidate) => candidate === "finally") ??
      group.kinds[0] ??
      "normal";
    const style = edgeStyle(kind, palette);
    const marker =
      kind === "back"
        ? "flow-arrow-back"
        : kind === "exception" || kind === "finally"
          ? "flow-arrow-soft"
          : "flow-arrow";
    const points = route.points
      .map((point) => `${coordinate(point.x)},${coordinate(point.y)}`)
      .join(" ");
    lines.push(
      `    <polyline points="${points}" fill="none" stroke="${style.stroke}" stroke-width="1.5"${style.dash === undefined ? "" : ` stroke-dasharray="${style.dash}"`} marker-end="url(#${marker})" data-flow-kind="${kind}" />`,
    );
    const text = group.labels.join(" / ");
    if (text !== "" && route.points.length >= 2) {
      const mid = route.points[Math.floor((route.points.length - 1) / 2)];
      const next = route.points[Math.floor((route.points.length - 1) / 2) + 1] ?? mid;
      if (mid !== undefined && next !== undefined) {
        const x = (mid.x + next.x) / 2;
        const y = (mid.y + next.y) / 2 - 4;
        lines.push(
          `    <text class="slop-edge-label" x="${coordinate(x)}" y="${coordinate(y)}" text-anchor="middle" font-size="10" fill="${style.stroke}">${escapeXml(text)}</text>`,
        );
      }
    }
  }

  for (const box of layout.nodes) {
    const block = blockById.get(box.id);
    if (block === undefined) {
      continue;
    }
    const isTerminal = block.kind === "entry" || block.kind === "exit";
    const style = isTerminal
      ? { fill: palette.containerFill, stroke: palette.containerStroke }
      : palette.kinds.function;
    const radius = isTerminal ? box.height / 2 : 4;
    // The box was sized for exactly this text (the synthetic node's name).
    const label = box.label;
    const dead = !reachable.has(box.id);
    const aria = dead ? `${label} (unreachable code)` : label;
    lines.push(
      `    <g class="slop-node${dead ? " slop-unreachable" : ""}" data-node-id="${escapeXml(box.id)}"${dead ? ' opacity="0.45"' : ""} role="button" tabindex="0" aria-label="${escapeXml(aria)}">`,
      `      <rect x="${coordinate(box.x)}" y="${coordinate(box.y)}" width="${coordinate(box.width)}" height="${coordinate(box.height)}" rx="${coordinate(radius)}" fill="${style.fill}" fill-opacity="${palette.fillOpacity}" stroke="${style.stroke}"${dead ? ' stroke-dasharray="4 3"' : ""} />`,
      `      <text x="${coordinate(box.x + box.width / 2)}" y="${coordinate(box.y + box.height / 2 + 4)}" text-anchor="middle" fill="${palette.text}">${escapeXml(label)}</text>`,
      ...(dead
        ? [
            `      <text class="slop-badge" x="${coordinate(box.x + box.width / 2)}" y="${coordinate(box.y - 4)}" text-anchor="middle" font-size="9" font-style="italic" fill="${palette.kinds.enum.stroke}">unreachable</text>`,
          ]
        : []),
      "    </g>",
    );
  }

  lines.push("  </g>", "</svg>");
  return `${lines.join("\n")}\n`;
}
