import type { NodeKind } from "../ir/types.js";
import type { EdgeTone } from "../layout/edgeEmphasis.js";

/**
 * The one palette every exporter draws from.
 *
 * A diagram exported as SVG, DOT or PlantUML should be recognizably the same
 * diagram, so the colours live here rather than in each exporter. Tone names
 * (`normal`/`muted`/`heritage`/`cycle`) come from `edgeEmphasis`, which the
 * webview uses too — the export matches what you saw on screen.
 */

export interface KindStyle {
  fill: string;
  stroke: string;
}

export interface Theme {
  background: string;
  text: string;
  containerFill: string;
  containerStroke: string;
  edge: string;
  edgeLow: string;
  heritage: string;
  cycle: string;
  fillOpacity: string;
  kinds: Record<NodeKind, KindStyle>;
}

export const LIGHT_THEME: Theme = {
  background: "#ffffff",
  text: "#1f2328",
  containerFill: "#f6f8fa",
  containerStroke: "#d0d7de",
  edge: "#57606a",
  edgeLow: "#a8b1ba",
  heritage: "#8250df",
  cycle: "#cf222e",
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

export const DARK_THEME: Theme = {
  background: "#0b0f17",
  text: "#e6edf3",
  containerFill: "#10151f",
  containerStroke: "#21262d",
  edge: "#8b949e",
  edgeLow: "#484f58",
  heritage: "#bc8cff",
  cycle: "#f85149",
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

/** `theme` option → palette; light is the default everywhere. */
export function themeFor(theme: "light" | "dark" | undefined): Theme {
  return theme === "dark" ? DARK_THEME : LIGHT_THEME;
}

/** The colour an edge of this tone is drawn in. */
export function toneColor(tone: EdgeTone, theme: Theme): string {
  switch (tone) {
    case "muted":
      return theme.edgeLow;
    case "heritage":
      return theme.heritage;
    case "cycle":
      return theme.cycle;
    default:
      return theme.edge;
  }
}
