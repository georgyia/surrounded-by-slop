/**
 * Webview entry point (browser). esbuild bundles this to
 * `packages/extension/dist/webview.js`; the diagram panel loads it inside a
 * strict-CSP iframe.
 *
 * It owns the viewport state and rendering; the gesture logic (what a click or
 * drag *means*) lives in the unit-tested `interactions` module, and the drawing
 * in the pure `render`/`viewport` modules. It persists the current diagram with
 * `setState`, so a window reload restores the view without re-analyzing.
 */
import { setupInteractions } from "./interactions.js";
import type { ColorTheme, DiagramData, HostToWebview, WebviewToHost } from "./protocol.js";
import { PROTOCOL_VERSION } from "./protocol.js";
import { renderDiagram } from "./render.js";
import {
  EMPTY_FILTER,
  type FilterableNode,
  type FilterState,
  isFiltering,
  matchingIds,
  topSegment,
} from "./search.js";
import {
  fitViewport,
  isLowDetail,
  panViewport,
  toTransform,
  type Viewport,
  zoomViewport,
} from "./viewport.js";

interface VsCodeApi {
  postMessage(message: WebviewToHost): void;
  getState(): { readonly diagram?: DiagramData } | undefined;
  setState(state: { readonly diagram?: DiagramData }): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

let diagram: DiagramData | undefined;
let theme: ColorTheme = "light";
let viewport: Viewport = { x: 0, y: 0, scale: 1 };
let viewportEl: SVGGElement | null = null;
let filter: FilterState = EMPTY_FILTER;
let nodeInfos: FilterableNode[] = [];
let soleMatch: string | null = null;

function rootElement(): HTMLElement | null {
  return document.getElementById("root");
}

function applyTransform(): void {
  viewportEl?.setAttribute("transform", toTransform(viewport));
  // Level-of-detail: zoomed far out, hide unreadable member labels (SBS-065).
  rootElement()?.classList.toggle("slop-lod", isLowDetail(viewport.scale));
}

function refit(): void {
  const root = rootElement();
  if (root === null || diagram === undefined) {
    return;
  }
  viewport = fitViewport(
    diagram.layout.width,
    diagram.layout.height,
    root.clientWidth,
    root.clientHeight,
  );
  applyTransform();
}

function paint(shouldRefit: boolean): void {
  const root = rootElement();
  if (root === null || diagram === undefined) {
    return;
  }
  try {
    root.innerHTML = renderDiagram(diagram.graph, diagram.layout, theme, diagram.expandableIds);
  } catch (error) {
    viewportEl = null;
    setStatus("Couldn't draw this diagram.");
    vscode.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  viewportEl = root.querySelector<SVGGElement>(".slop-viewport");
  if (shouldRefit) {
    refit();
  } else {
    applyTransform();
  }
  applyFilter(); // a fresh SVG has no dim/match classes — re-apply the current filter
}

function setStatus(text: string): void {
  const root = rootElement();
  if (root === null) {
    return;
  }
  root.replaceChildren();
  const status = document.createElement("div");
  status.className = "slop-status";
  status.textContent = text;
  root.append(status);
  viewportEl = null;
  byId("toolbar")?.classList.add("slop-hidden");
}

function applyTheme(next: ColorTheme): void {
  theme = next;
  document.documentElement.dataset.theme = next;
}

// ---- Search & filter toolbar (SBS-063) ----

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

/** A new diagram arrived: rebuild the filter chips and clear any active filter. */
function onNewDiagram(next: DiagramData): void {
  nodeInfos = next.graph.nodes.map((node) => ({
    id: node.id,
    label: node.name,
    kind: node.kind,
    path: node.span?.file ?? node.qualifiedName,
  }));
  filter = EMPTY_FILTER;
  const search = byId<HTMLInputElement>("search");
  if (search !== null) {
    search.value = "";
  }
  rebuildChips();
  byId("toolbar")?.classList.remove("slop-hidden");
  byId("reset")?.classList.toggle("slop-hidden", next.isolated !== true);
}

function rebuildChips(): void {
  const kinds = [...new Set(nodeInfos.map((node) => node.kind))].sort();
  const paths = [...new Set(nodeInfos.map((node) => topSegment(node.path)))].sort();
  fillChipRow(byId("kind-chips"), kinds, "kind");
  fillChipRow(byId("path-chips"), paths, "path");
}

function fillChipRow(row: HTMLElement | null, values: string[], group: "kind" | "path"): void {
  if (row === null) {
    return;
  }
  row.replaceChildren();
  // A single value can't filter anything — don't clutter the toolbar with it.
  if (values.length < 2) {
    return;
  }
  for (const value of values) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "slop-chip";
    chip.textContent = value;
    chip.dataset.group = group;
    chip.dataset.value = value;
    chip.setAttribute("aria-pressed", "true");
    row.append(chip);
  }
}

function disabledFromChips(group: "kind" | "path"): Set<string> {
  const disabled = new Set<string>();
  const chips = document.querySelectorAll<HTMLElement>(`.slop-chip[data-group="${group}"]`);
  for (const chip of Array.from(chips)) {
    if (chip.getAttribute("aria-pressed") === "false" && chip.dataset.value !== undefined) {
      disabled.add(chip.dataset.value);
    }
  }
  return disabled;
}

/** Toggle dim/match classes on the rendered nodes for the current filter. */
function applyFilter(): void {
  const root = rootElement();
  if (root === null) {
    return;
  }
  const active = isFiltering(filter);
  const matches = new Set(matchingIds(nodeInfos, filter));
  for (const node of Array.from(root.querySelectorAll<SVGElement>("[data-node-id]"))) {
    const id = node.getAttribute("data-node-id");
    const pass = !active || (id !== null && matches.has(id));
    node.classList.toggle("slop-dim", active && !pass);
    node.classList.toggle("slop-match", active && pass);
  }
  soleMatch = active && matches.size === 1 ? ([...matches][0] ?? null) : null;
  const isolate = byId<HTMLButtonElement>("isolate");
  if (isolate !== null) {
    isolate.disabled = soleMatch === null;
  }
}

function setFilter(next: FilterState): void {
  filter = next;
  applyFilter();
}

function setupToolbar(): void {
  const search = byId<HTMLInputElement>("search");
  search?.addEventListener("input", () => setFilter({ ...filter, query: search.value.trim() }));
  search?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      search.value = "";
      setFilter({ ...filter, query: "" });
    }
  });

  byId("toolbar")?.addEventListener("click", (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.classList.contains("slop-chip")) {
      const pressed = target.getAttribute("aria-pressed") !== "false";
      target.setAttribute("aria-pressed", pressed ? "false" : "true");
      setFilter({
        ...filter,
        disabledKinds: disabledFromChips("kind"),
        disabledPaths: disabledFromChips("path"),
      });
    }
  });

  byId<HTMLButtonElement>("isolate")?.addEventListener("click", () => {
    if (soleMatch !== null) {
      vscode.postMessage({ type: "isolate", nodeId: soleMatch });
    }
  });
  byId<HTMLButtonElement>("reset")?.addEventListener("click", () => {
    vscode.postMessage({ type: "resetView" });
  });

  // "/" focuses search from anywhere; a keyboard-first way in.
  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && document.activeElement !== search) {
      event.preventDefault();
      search?.focus();
    }
  });
}

window.addEventListener("message", (event: MessageEvent<HostToWebview>) => {
  const message = event.data;
  switch (message.type) {
    case "render":
      applyTheme(message.theme);
      diagram = message.diagram;
      vscode.setState({ diagram: message.diagram });
      onNewDiagram(message.diagram);
      paint(message.fit);
      break;
    case "theme":
      applyTheme(message.theme);
      paint(false); // re-color, keep the current pan/zoom
      break;
  }
});

function boot(): void {
  const root = rootElement();
  if (root !== null) {
    setupInteractions(root, {
      isActive: () => viewportEl !== null,
      pan: (deltaX, deltaY) => {
        viewport = panViewport(viewport, deltaX, deltaY);
        applyTransform();
      },
      zoom: (factor, pivotX, pivotY) => {
        viewport = zoomViewport(viewport, factor, pivotX, pivotY);
        applyTransform();
      },
      fit: refit,
      reveal: (nodeId, toSide) => vscode.postMessage({ type: "revealNode", nodeId, toSide }),
      toggleExpand: (nodeId) => vscode.postMessage({ type: "toggleExpand", nodeId }),
    });
  }
  setupToolbar();
  // Reload path: VS Code preserves our last setState, so restore before we
  // announce readiness (the host has nothing to resend). Fresh path: wait.
  const restored = vscode.getState()?.diagram;
  if (restored !== undefined) {
    diagram = restored;
    onNewDiagram(restored);
    paint(true);
  } else {
    setStatus("Waiting for a diagram…");
  }
  vscode.postMessage({ type: "ready", protocol: PROTOCOL_VERSION });
}

boot();
