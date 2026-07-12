/**
 * The diagram's visual vocabulary as data (SBS-061), kept pure so it can be
 * unit-tested and so the legend swatches are guaranteed to match what the
 * renderer draws (both read the same palette). `main.ts` turns these entries
 * into small SVG swatches beside their labels.
 */
import type { NodeKind } from "@surrounded-by-slop/core";
import type { Theme } from "./render.js";

export interface LegendEntry {
  readonly label: string;
  readonly fill: string;
  readonly stroke: string;
  /** Edge entries only: drawn as a dashed line. */
  readonly dashed?: boolean;
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

/** The fixed edge vocabulary (line style ⇒ relationship). */
export function edgeLegend(palette: Theme): LegendEntry[] {
  return [
    { label: "calls", fill: "none", stroke: palette.edge },
    { label: "imports", fill: "none", stroke: palette.edge, dashed: true },
    { label: "extends / implements", fill: "none", stroke: palette.heritage },
    { label: "inferred (low confidence)", fill: "none", stroke: palette.edgeLow, dashed: true },
  ];
}
