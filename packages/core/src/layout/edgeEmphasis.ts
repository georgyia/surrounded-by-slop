import type { GraphEdge } from "../ir/types.js";

/**
 * How much an edge should stand out (#99).
 *
 * A module map draws every relationship identically, so a utility imported
 * forty times looks exactly like a one-off reference and the reader has no way
 * to find the load-bearing dependencies. The graph already knows the
 * difference — `count`, `typeOnly` and `inCycle` are all computed during
 * analysis and were being thrown away at render time.
 *
 * The decision lives here, in core, because two renderers consume it: the
 * webview and the standalone SVG exporter. Duplicating the rules would let the
 * exported picture drift from the one on screen, and "what you export is what
 * you saw" is the whole point of the shared layout.
 *
 * Tones are named, not coloured — each renderer maps them onto its own theme.
 */

export type EdgeTone = "normal" | "muted" | "heritage" | "cycle";

export interface EdgeEmphasis {
  readonly tone: EdgeTone;
  /** SVG stroke width in px. */
  readonly width: number;
  readonly dash: boolean;
}

/** Thin enough to read as background texture when many edges overlap. */
const MIN_WIDTH = 1.2;
/** Past this, thicker lines stop reading as "heavier" and just blur together. */
const MAX_WIDTH = 3.5;
/** One doubling of occurrences ⇒ one step of this much extra width. */
const WIDTH_PER_DOUBLING = 0.75;

/**
 * Occurrence count → stroke width, on a log scale: the interesting contrast is
 * between 1 and 10 uses, not between 40 and 50, and a linear ramp would let a
 * single hub swamp the picture.
 */
export function edgeWidth(count: number | undefined): number {
  const occurrences = count === undefined || count < 1 ? 1 : count;
  const width = MIN_WIDTH + WIDTH_PER_DOUBLING * Math.log2(occurrences);
  return Math.round(Math.min(width, MAX_WIDTH) * 100) / 100;
}

export function edgeEmphasis(edge: GraphEdge): EdgeEmphasis {
  if (edge.kind === "extends" || edge.kind === "implements") {
    return { tone: "heritage", width: MIN_WIDTH, dash: edge.kind === "implements" };
  }
  // Inferred edges and type-only imports are both "less real" than a call: one
  // might not exist, the other is erased before the code ever runs. Neither
  // should compete for attention with runtime coupling.
  if (edge.confidence === "low" || edge.typeOnly === true) {
    return { tone: "muted", width: MIN_WIDTH, dash: true };
  }
  // Cycles are what people open an architecture diagram to find, so they win
  // over ordinary weighting — but they keep their weight, since a heavily used
  // cycle matters more than an incidental one.
  return {
    tone: edge.inCycle === true ? "cycle" : "normal",
    width: edgeWidth(edge.count),
    dash: edge.kind === "imports",
  };
}
