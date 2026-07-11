/**
 * Webview entry point (browser). esbuild bundles this to
 * `packages/extension/dist/webview.js`; the diagram panel loads it inside a
 * strict-CSP iframe. For now it shows a waiting state — the message channel and
 * the interactive renderer arrive with the panel (SBS-043) and the Visualize
 * File command (SBS-042).
 */
import { PROTOCOL_VERSION } from "./protocol.js";

function main(): void {
  const root = document.getElementById("root");
  if (root !== null) {
    root.textContent = `Surrounded by Slop (protocol v${PROTOCOL_VERSION}) — waiting for a diagram…`;
  }
}

main();
