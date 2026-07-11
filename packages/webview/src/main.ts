/**
 * Webview entry point (browser). esbuild bundles this to
 * `packages/extension/dist/webview.js`; the diagram panel loads it inside a
 * strict-CSP iframe.
 *
 * It owns the DOM and pointer events; every piece of logic worth testing lives
 * in the pure `render`/`viewport` modules. It also persists the current diagram
 * with `setState`, so a window reload restores the view without re-analyzing.
 */
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

function nodeIdAt(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) {
    return null;
  }
  return target.closest("[data-node-id]")?.getAttribute("data-node-id") ?? null;
}

function setupInteractions(root: HTMLElement): void {
  root.addEventListener(
    "wheel",
    (event) => {
      if (viewportEl === null) {
        return;
      }
      event.preventDefault();
      const rect = root.getBoundingClientRect();
      const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
      viewport = zoomViewport(
        viewport,
        factor,
        event.clientX - rect.left,
        event.clientY - rect.top,
      );
      applyTransform();
    },
    { passive: false },
  );

  let dragging = false;
  let downX = 0;
  let downY = 0;
  root.addEventListener("pointerdown", (event) => {
    downX = event.clientX;
    downY = event.clientY;
    if (viewportEl === null || event.button !== 0) {
      return;
    }
    dragging = true;
    root.classList.add("slop-dragging");
    root.setPointerCapture(event.pointerId);
  });
  root.addEventListener("pointermove", (event) => {
    if (dragging) {
      viewport = panViewport(viewport, event.movementX, event.movementY);
      applyTransform();
    }
  });
  const endDrag = (event: PointerEvent): void => {
    if (!dragging) {
      return;
    }
    dragging = false;
    root.classList.remove("slop-dragging");
    if (root.hasPointerCapture(event.pointerId)) {
      root.releasePointerCapture(event.pointerId);
    }
  };
  root.addEventListener("pointerup", endDrag);
  root.addEventListener("pointercancel", endDrag);

  // Double-click empty space to re-fit the whole diagram.
  root.addEventListener("dblclick", refit);

  // Click (or Enter/Space on a focused node) jumps to the declaration; a genuine
  // pan-drag is ignored so dragging the canvas never triggers a jump.
  root.addEventListener("click", (event) => {
    const nodeId = nodeIdAt(event.target);
    if (nodeId === null || Math.hypot(event.clientX - downX, event.clientY - downY) > 4) {
      return;
    }
    vscode.postMessage({ type: "revealNode", nodeId, toSide: event.ctrlKey || event.metaKey });
  });
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    const nodeId = nodeIdAt(event.target);
    if (nodeId === null) {
      return;
    }
    event.preventDefault();
    vscode.postMessage({ type: "revealNode", nodeId, toSide: event.ctrlKey || event.metaKey });
  });
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
    setupInteractions(root);
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
