/**
 * The diagram's visual vocabulary as data (SBS-061), kept pure so it can be
 * unit-tested and so the legend swatches are guaranteed to match what the
 * renderer draws (both read the same palette). `main.ts` turns these entries
 * into small SVG swatches beside their labels.
 */
import { edgeEmphasis, type GraphEdge, type NodeKind } from "@surrounded-by-slop/core";
import type { Theme } from "./render.js";

export interface LegendEntry {
  readonly label: string;
  readonly fill: string;
  readonly stroke: string;
  /** Edge entries only: drawn as a dashed line. */
  readonly dashed?: boolean;
  /** Edge entries only: stroke width, when the entry is demonstrating weight. */
  readonly weight?: number;
}

const KIND_LABELS: Record<NodeKind, string> = {
  module: "Module",
  namespace: "Namespace",
  class: "Class",
  interface: "Interface",
  enum: "Enum",
  function: "Function",
  method: "Method",
  variable: "Variable",
  folder: "Folder",
};

const KIND_ORDER = Object.keys(KIND_LABELS) as NodeKind[];

/** Swatches for the node kinds actually present, in a stable order. */
export function nodeLegend(kinds: Iterable<NodeKind>, palette: Theme): LegendEntry[] {
  const present = new Set(kinds);
  return KIND_ORDER.filter((kind) => present.has(kind)).map((kind) => ({
    label: KIND_LABELS[kind],
    fill: palette.kinds[kind].fill,
    stroke: palette.kinds[kind].stroke,
  }));
}

/**
 * The edge vocabulary (line style ⇒ relationship), narrowed to the styles the
 * diagram actually draws. A legend explains the picture, not the feature set:
 * a codebase with no cycles and no type-only imports should not be told what
 * those would have looked like.
 *
 * Presence is decided by running the edges through the same `edgeEmphasis` the
 * renderer uses, so an entry appears exactly when a line of that style exists.
 * Thickness is a second, independent channel — how often the relationship
 * occurs (#99) — and only worth explaining once two edges actually differ.
 */
export function edgeLegend(edges: Iterable<GraphEdge>, palette: Theme): LegendEntry[] {
  let calls = false;
  let imports = false;
  let heritage = false;
  let cycle = false;
  let muted = false;
  const widths = new Set<number>();

  for (const edge of edges) {
    const { tone, width, dash } = edgeEmphasis(edge);
    widths.add(width);
    if (tone === "heritage") {
      heritage = true;
    } else if (tone === "muted") {
      muted = true;
    } else {
      if (tone === "cycle") {
        cycle = true;
      }
      // Within the solid tones, dashing is what separates an import from a call.
      if (dash) {
        imports = true;
      } else {
        calls = true;
      }
    }
  }

  const entries: LegendEntry[] = [];
  if (calls) {
    entries.push({ label: "calls", fill: "none", stroke: palette.edge });
  }
  if (imports) {
    entries.push({ label: "imports", fill: "none", stroke: palette.edge, dashed: true });
  }
  if (heritage) {
    entries.push({ label: "extends / implements", fill: "none", stroke: palette.heritage });
  }
  if (cycle) {
    entries.push({ label: "in an import cycle", fill: "none", stroke: palette.cycle });
  }
  if (muted) {
    entries.push({
      label: "type-only / inferred",
      fill: "none",
      stroke: palette.edgeLow,
      dashed: true,
    });
  }
  if (widths.size > 1) {
    entries.push({
      label: "thicker = used more often",
      fill: "none",
      stroke: palette.edge,
      weight: 3.5,
    });
  }
  return entries;
}

/** The flowchart vocabulary (SBS-071): what a function-flow diagram's lines mean. */
export function flowLegend(palette: Theme): LegendEntry[] {
  return [
    { label: "flow / branch (labeled)", fill: "none", stroke: palette.edge },
    { label: "loop back", fill: "none", stroke: palette.heritage, dashed: true },
    { label: "throws", fill: "none", stroke: palette.kinds.enum.stroke, dashed: true },
    { label: "finally re-route", fill: "none", stroke: palette.edgeLow, dashed: true },
  ];
}
