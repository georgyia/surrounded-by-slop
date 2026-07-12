import type { ColorTheme } from "./protocol.js";

export interface DiagramHtmlOptions {
  /** `webview.asWebviewUri(...)` of the bundled `webview.js`. */
  readonly scriptUri: string;
  /** `webview.cspSource` — the origin the webview serves local resources from. */
  readonly cspSource: string;
  /** A fresh, single-use nonce (see `createNonce`). */
  readonly nonce: string;
  /** Initial theme, so the first paint matches the editor. */
  readonly theme: ColorTheme;
}

/**
 * The webview's HTML document, built host-side and handed to VS Code.
 *
 * Pure on purpose: the Content-Security-Policy is the security boundary for
 * untrusted diagram data, so it is unit-tested here rather than eyeballed in a
 * running editor. Scripts run only with the matching nonce — no `unsafe-inline`
 * anywhere — and the renderer styles nodes with SVG presentation attributes and
 * a single nonce'd stylesheet, never inline `style=` attributes.
 */
export function buildDiagramHtml(options: DiagramHtmlOptions): string {
  const { scriptUri, cspSource, nonce, theme } = options;
  const csp = [
    "default-src 'none'",
    `img-src ${cspSource} data:`,
    `style-src ${cspSource} 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
    `font-src ${cspSource}`,
  ].join("; ");

  return `<!DOCTYPE html>
<html lang="en" data-theme="${theme}">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Slop Diagram</title>
  <style nonce="${nonce}">
    html, body { height: 100%; margin: 0; padding: 0; }
    body {
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-editor-font-family, ui-monospace, monospace);
      overflow: hidden;
    }
    #root { width: 100vw; height: 100vh; cursor: grab; }
    #root.slop-dragging { cursor: grabbing; }
    .slop-diagram { display: block; animation: slop-fade 140ms ease; }
    @keyframes slop-fade { from { opacity: 0.35; } to { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .slop-diagram { animation: none; } }
    .slop-container { cursor: pointer; }
    .slop-container:focus-visible { outline: none; }
    .slop-container:focus-visible rect { stroke-width: 2; }
    .slop-caret { pointer-events: none; opacity: 0.6; }
    .slop-node { cursor: pointer; }
    .slop-node:focus-visible { outline: none; }
    .slop-node:focus-visible rect { stroke-width: 2.5; }
    /* Level-of-detail: zoomed far out, fade unreadable member labels (SBS-065). */
    .slop-node text { transition: opacity 120ms ease; }
    #root.slop-lod .slop-node text { opacity: 0; }
    @media (prefers-reduced-motion: reduce) { .slop-node text { transition: none; } }
    .slop-status {
      display: flex; align-items: center; justify-content: center;
      height: 100%; padding: 1rem; text-align: center; opacity: 0.7;
    }
  </style>
</head>
<body>
  <div id="root"><div class="slop-status">Loading diagram…</div></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

/** A cryptographically-random nonce for the CSP. Node and modern browsers both expose Web Crypto. */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}
