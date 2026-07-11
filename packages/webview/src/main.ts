/**
 * Webview entry point (browser). esbuild bundles this to
 * `packages/extension/dist/webview.js`; the diagram panel loads it inside a
 * strict-CSP iframe.
 *
 * Responsibilities: complete the version handshake with the host, receive
 * diagrams, and — crucially — persist the current diagram with `setState` so a
 * window reload restores it without the host re-analyzing. The interactive SVG
 * renderer replaces `render()` in SBS-042; the message plumbing stays put.
 */

import type { DiagramData, HostToWebview, WebviewToHost } from "./protocol.js";
import { PROTOCOL_VERSION } from "./protocol.js";

interface VsCodeApi {
  postMessage(message: WebviewToHost): void;
  getState(): { readonly diagram?: DiagramData } | undefined;
  setState(state: { readonly diagram?: DiagramData }): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

function setStatus(text: string): void {
  const root = document.getElementById("root");
  if (root !== null) {
    root.replaceChildren();
    const status = document.createElement("div");
    status.className = "slop-status";
    status.textContent = text;
    root.append(status);
  }
}

function applyTheme(theme: "light" | "dark"): void {
  document.documentElement.dataset.theme = theme;
}

/** Placeholder render — SBS-042 replaces this with the interactive SVG diagram. */
function render(diagram: DiagramData): void {
  setStatus(
    `${diagram.title} — ${diagram.graph.nodes.length} nodes, ${diagram.graph.edges.length} edges`,
  );
}

window.addEventListener("message", (event: MessageEvent<HostToWebview>) => {
  const message = event.data;
  switch (message.type) {
    case "render":
      applyTheme(message.theme);
      vscode.setState({ diagram: message.diagram });
      render(message.diagram);
      break;
    case "theme":
      applyTheme(message.theme);
      break;
  }
});

function boot(): void {
  // Reload path: VS Code preserves our last setState across a window reload, so
  // restore the diagram before announcing readiness (the host has nothing to
  // resend). Fresh path: show a waiting state until the first render arrives.
  const restored = vscode.getState()?.diagram;
  if (restored !== undefined) {
    render(restored);
  } else {
    setStatus("Waiting for a diagram…");
  }
  vscode.postMessage({ type: "ready", protocol: PROTOCOL_VERSION });
}

boot();
