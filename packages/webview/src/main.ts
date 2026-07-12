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
import { fitViewport, panViewport, toTransform, type Viewport, zoomViewport } from "./viewport.js";

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

function rootElement(): HTMLElement | null {
  return document.getElementById("root");
}

function applyTransform(): void {
  viewportEl?.setAttribute("transform", toTransform(viewport));
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
    root.innerHTML = renderDiagram(diagram.graph, diagram.layout, theme);
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
}

function applyTheme(next: ColorTheme): void {
  theme = next;
  document.documentElement.dataset.theme = next;
}

window.addEventListener("message", (event: MessageEvent<HostToWebview>) => {
  const message = event.data;
  switch (message.type) {
    case "render":
      applyTheme(message.theme);
      diagram = message.diagram;
      vscode.setState({ diagram: message.diagram });
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
    });
  }
  // Reload path: VS Code preserves our last setState, so restore before we
  // announce readiness (the host has nothing to resend). Fresh path: wait.
  const restored = vscode.getState()?.diagram;
  if (restored !== undefined) {
    diagram = restored;
    paint(true);
  } else {
    setStatus("Waiting for a diagram…");
  }
  vscode.postMessage({ type: "ready", protocol: PROTOCOL_VERSION });
}

boot();
