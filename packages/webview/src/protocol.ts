import type { GraphLayout, SemanticGraph } from "@surrounded-by-slop/core";

/**
 * Version of the message protocol between the extension host and the webview.
 *
 * The host embeds this value in the webview bootstrap and refuses to talk to
 * a webview built against a different version — a stale webview bundle after
 * an update must fail loudly, not render a subtly wrong diagram. Bump on any
 * breaking change to a message shape.
 */
export const PROTOCOL_VERSION = 1;

/** Which of the two built-in palettes to draw with. */
export type ColorTheme = "light" | "dark";

/**
 * One diagram: the semantic graph plus the positions computed for it. Both come
 * from the pure core; the webview only renders them. This is exactly what the
 * webview persists (via `setState`) so it can restore after a reload.
 */
export interface DiagramData {
  readonly title: string;
  readonly graph: SemanticGraph;
  readonly layout: GraphLayout;
  /**
   * Ids of collapsed containers that hide members — the nodes a double-click
   * can expand (SBS-062). Absent for fully-expanded views like a single file.
   */
  readonly expandableIds?: readonly string[];
  /** True when this diagram is an isolated slice around one node (SBS-063). */
  readonly isolated?: boolean;
}

/** Messages the extension host sends to the webview. */
export type HostToWebview =
  | {
      readonly type: "render";
      readonly diagram: DiagramData;
      readonly theme: ColorTheme;
      /** Fit the diagram to the viewport; false on a same-file refresh so pan/zoom is kept. */
      readonly fit: boolean;
    }
  | { readonly type: "theme"; readonly theme: ColorTheme };

/** Messages the webview sends back to the extension host. */
export type WebviewToHost =
  | { readonly type: "ready"; readonly protocol: number }
  | { readonly type: "revealNode"; readonly nodeId: string; readonly toSide: boolean }
  | { readonly type: "toggleExpand"; readonly nodeId: string }
  | { readonly type: "isolate"; readonly nodeId: string }
  | { readonly type: "resetView" }
  | { readonly type: "error"; readonly message: string };
