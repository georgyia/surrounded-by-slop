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
import type { GraphNode, NodeKind } from "@surrounded-by-slop/core";
import { renderFlowDiagram } from "./flowRender.js";
import { type Degree, edgeDegrees, hoverDetails } from "./hover.js";
import { setupInteractions } from "./interactions.js";
import { edgeLegend, flowLegend, type LegendEntry, nodeLegend } from "./legend.js";
import type { ColorTheme, DiagramData, HostToWebview, WebviewToHost } from "./protocol.js";
import { PROTOCOL_VERSION } from "./protocol.js";
import { paletteFor, renderDiagram } from "./render.js";
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
let nodeById = new Map<string, GraphNode>();
let degrees = new Map<string, Degree>();
let hoverTimer: ReturnType<typeof setTimeout> | undefined;
let hoverId: string | null = null;
let hoverEl: Element | null = null;

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
  hideHover(); // the SVG is about to be replaced — drop any card tied to it
  try {
    root.innerHTML =
      diagram.flow === undefined
        ? renderDiagram(diagram.graph, diagram.layout, theme, diagram.expandableIds)
        : renderFlowDiagram(diagram.flow, diagram.layout, theme);
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
  byId("legend")?.classList.add("slop-hidden");
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
  nodeById = new Map(next.graph.nodes.map((node) => [node.id, node]));
  degrees = edgeDegrees(next.graph);
  hideHover();
  filter = EMPTY_FILTER;
  const search = byId<HTMLInputElement>("search");
  if (search !== null) {
    search.value = "";
  }
  rebuildChips();
  buildLegend();
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
  // Isolate slices the semantic graph — meaningless for a flowchart's blocks.
  soleMatch =
    active && diagram?.flow === undefined && matches.size === 1 ? ([...matches][0] ?? null) : null;
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
  byId<HTMLButtonElement>("legend-toggle")?.addEventListener("click", () => {
    const hidden = byId("legend")?.classList.toggle("slop-hidden");
    byId("legend-toggle")?.setAttribute("aria-expanded", hidden === false ? "true" : "false");
  });

  // "/" focuses search from anywhere; a keyboard-first way in.
  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && document.activeElement !== search) {
      event.preventDefault();
      search?.focus();
    }
  });
}

// ---- Legend (SBS-061) ----

const SVG_NS = "http://www.w3.org/2000/svg";

/** A small SVG swatch for a legend entry — built with presentation attributes
 * (never inline CSS) so it renders under the strict webview CSP. */
function legendSwatch(entry: LegendEntry, isNode: boolean): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  if (isNode) {
    svg.setAttribute("width", "14");
    svg.setAttribute("height", "14");
    const rect = document.createElementNS(SVG_NS, "rect");
    for (const [name, value] of [
      ["x", "1"],
      ["y", "1"],
      ["width", "12"],
      ["height", "12"],
      ["rx", "3"],
      ["fill", entry.fill],
      ["fill-opacity", paletteFor(theme).fillOpacity],
      ["stroke", entry.stroke],
    ]) {
      rect.setAttribute(name ?? "", value ?? "");
    }
    svg.append(rect);
  } else {
    svg.setAttribute("width", "24");
    svg.setAttribute("height", "10");
    const line = document.createElementNS(SVG_NS, "line");
    for (const [name, value] of [
      ["x1", "1"],
      ["y1", "5"],
      ["x2", "23"],
      ["y2", "5"],
      ["stroke", entry.stroke],
      ["stroke-width", "2"],
    ]) {
      line.setAttribute(name ?? "", value ?? "");
    }
    if (entry.dashed === true) {
      line.setAttribute("stroke-dasharray", "5 3");
    }
    svg.append(line);
  }
  return svg;
}

/** Rebuild the legend for the kinds present in the current diagram and theme. */
function buildLegend(): void {
  const container = byId("legend");
  if (container === null) {
    return;
  }
  const palette = paletteFor(theme);
  const kinds = [...new Set(nodeInfos.map((node) => node.kind))] as NodeKind[];
  container.replaceChildren();
  const section = (title: string, entries: LegendEntry[], isNode: boolean): void => {
    if (entries.length === 0) {
      return;
    }
    const heading = document.createElement("h2");
    heading.textContent = title;
    container.append(heading);
    for (const entry of entries) {
      const row = document.createElement("div");
      row.className = "slop-legend-row";
      row.append(legendSwatch(entry, isNode));
      const label = document.createElement("span");
      label.textContent = entry.label;
      row.append(label);
      container.append(row);
    }
  };
  if (diagram?.flow === undefined) {
    section("Nodes", nodeLegend(kinds, palette), true);
    section("Edges", edgeLegend(palette), false);
  } else {
    section("Flow", flowLegend(palette), false);
  }
}

// ---- Hover details (SBS-064) ----

function renderHoverCard(node: GraphNode): void {
  const card = byId("hovercard");
  if (card === null) {
    return;
  }
  const details = hoverDetails(node, degrees);
  card.replaceChildren();

  const header = document.createElement("div");
  const name = document.createElement("span");
  name.className = "slop-hc-name";
  name.textContent = details.name;
  const kind = document.createElement("span");
  kind.className = "slop-hc-kind";
  // Flowchart nodes are CFG blocks, whatever kind the synthetic layout node used.
  kind.textContent = diagram?.flow === undefined ? details.kind : "block";
  header.append(name, kind);
  card.append(header);

  if (details.signature !== undefined) {
    const code = document.createElement("code");
    code.textContent = details.signature;
    card.append(code);
  }
  if (details.doc !== undefined) {
    const doc = document.createElement("div");
    doc.className = "slop-hc-doc";
    doc.textContent = details.doc;
    card.append(doc);
  }
  const meta = document.createElement("div");
  meta.className = "slop-hc-meta";
  const parts = details.location === undefined ? [] : [details.location];
  parts.push(`${details.incoming} in · ${details.outgoing} out`);
  meta.textContent = parts.join("  •  ");
  card.append(meta);
}

/** Place the card near (x, y), flipping so it never spills off-screen. */
function positionHover(x: number, y: number): void {
  const card = byId("hovercard");
  if (card === null) {
    return;
  }
  const gap = 14;
  const rect = card.getBoundingClientRect();
  let left = x + gap;
  let top = y + gap;
  if (left + rect.width > window.innerWidth) {
    left = x - gap - rect.width;
  }
  if (top + rect.height > window.innerHeight) {
    top = y - gap - rect.height;
  }
  card.style.left = `${Math.max(4, left)}px`;
  card.style.top = `${Math.max(4, top)}px`;
}

function showHover(id: string, x: number, y: number, element: Element): void {
  const node = nodeById.get(id);
  if (node === undefined) {
    return;
  }
  renderHoverCard(node);
  byId("hovercard")?.classList.remove("slop-hidden");
  positionHover(x, y);
  element.setAttribute("aria-describedby", "hovercard");
}

function hideHover(): void {
  if (hoverTimer !== undefined) {
    clearTimeout(hoverTimer);
    hoverTimer = undefined;
  }
  byId("hovercard")?.classList.add("slop-hidden");
  hoverEl?.removeAttribute("aria-describedby");
  hoverEl = null;
  hoverId = null;
}

function setupHover(root: HTMLElement): void {
  root.addEventListener("pointermove", (event) => {
    if (root.classList.contains("slop-dragging")) {
      hideHover();
      return;
    }
    const element = event.target instanceof Element ? event.target.closest("[data-node-id]") : null;
    const id = element?.getAttribute("data-node-id") ?? null;
    if (id === hoverId) {
      if (id !== null) {
        positionHover(event.clientX, event.clientY);
      }
      return;
    }
    hideHover();
    hoverId = id;
    hoverEl = element;
    if (id !== null && element !== null) {
      const { clientX, clientY } = event;
      hoverTimer = setTimeout(() => {
        if (hoverId === id) {
          showHover(id, clientX, clientY, element);
        }
      }, 120);
    }
  });
  root.addEventListener("pointerleave", hideHover);
  // Keyboard / screen readers: focusing a node reveals its card immediately.
  root.addEventListener("focusin", (event) => {
    const element = event.target instanceof Element ? event.target.closest("[data-node-id]") : null;
    const id = element?.getAttribute("data-node-id") ?? null;
    if (id === null || element === null) {
      return;
    }
    hideHover();
    hoverId = id;
    hoverEl = element;
    const rect = element.getBoundingClientRect();
    showHover(id, rect.left, rect.bottom, element);
  });
  root.addEventListener("focusout", hideHover);
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
      buildLegend(); // swatches follow the new palette
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
    setupHover(root);
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
