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
    /* Search & filter toolbar (SBS-063) — floats over the diagram. */
    #toolbar {
      position: fixed; top: 8px; left: 8px; right: 8px; z-index: 5;
      display: flex; flex-wrap: wrap; gap: 6px 8px; align-items: center;
      padding: 6px 8px; border-radius: 8px;
      background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
      border: 1px solid var(--vscode-editorWidget-border, transparent);
      box-shadow: 0 1px 4px rgba(0,0,0,0.25);
      font-size: 12px; opacity: 0.55; transition: opacity 120ms ease;
    }
    #toolbar:hover, #toolbar:focus-within { opacity: 1; }
    #toolbar.slop-hidden { display: none; }
    #search {
      flex: 1 1 160px; min-width: 120px; padding: 3px 6px;
      color: var(--vscode-input-foreground); background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, var(--vscode-contrastBorder, #8884));
      border-radius: 4px; font-family: inherit; font-size: 12px;
    }
    #search:focus-visible { outline: 1px solid var(--vscode-focusBorder); }
    .slop-chip-row { display: flex; flex-wrap: wrap; gap: 4px; }
    .slop-chip {
      padding: 2px 8px; border-radius: 10px; cursor: pointer;
      border: 1px solid var(--vscode-input-border, #8884);
      background: var(--vscode-badge-background, #8883); color: var(--vscode-badge-foreground);
      font-family: inherit; font-size: 11px; user-select: none;
    }
    .slop-chip[aria-pressed="false"] { opacity: 0.4; text-decoration: line-through; }
    .slop-btn {
      padding: 2px 8px; border-radius: 4px; cursor: pointer;
      border: 1px solid var(--vscode-button-border, transparent);
      background: var(--vscode-button-secondaryBackground, #8883);
      color: var(--vscode-button-secondaryForeground, inherit);
      font-family: inherit; font-size: 11px;
    }
    .slop-btn:disabled { opacity: 0.4; cursor: default; }
    /* Filter feedback: matches keep full opacity, the rest dims. */
    .slop-dim { opacity: 0.12; }
    .slop-node.slop-match rect { stroke-width: 2.5; }
    /* Data-flow overlay (SBS-072): writes orange, reads blue, rest dimmed. */
    .slop-chip[data-selected="true"] { outline: 1.5px solid var(--vscode-focusBorder, #54aeff); }
    .slop-node.slop-df-write rect { stroke: #f0883e; stroke-width: 3; }
    .slop-node.slop-df-read rect { stroke: #54aeff; stroke-width: 2.5; }
    .slop-node.slop-df-write.slop-df-read rect {
      stroke: #f0883e; stroke-width: 3; stroke-dasharray: 8 3;
    }
    /* Legend (SBS-061) — a floating key to the visual language. */
    #legend {
      position: fixed; bottom: 8px; left: 8px; z-index: 5;
      max-width: 240px; padding: 8px 10px; border-radius: 8px;
      background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
      border: 1px solid var(--vscode-editorWidget-border, transparent);
      box-shadow: 0 1px 4px rgba(0,0,0,0.25); font-size: 11px;
    }
    #legend.slop-hidden { display: none; }
    #legend h2 {
      margin: 6px 0 3px; font-size: 10px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.04em; opacity: 0.6;
    }
    #legend h2:first-child { margin-top: 0; }
    .slop-legend-row { display: flex; align-items: center; gap: 6px; padding: 1px 0; }
    .slop-legend-row svg { flex: none; }
    /* Hover card (SBS-064) — details on demand, never intercepts the pointer. */
    #hovercard {
      position: fixed; z-index: 6; pointer-events: none; max-width: 320px;
      padding: 6px 9px; border-radius: 6px; font-size: 11px; line-height: 1.45;
      background: var(--vscode-editorHoverWidget-background, var(--vscode-editorWidget-background));
      color: var(--vscode-editorHoverWidget-foreground, var(--vscode-editor-foreground));
      border: 1px solid var(--vscode-editorHoverWidget-border, var(--vscode-editorWidget-border, #8884));
      box-shadow: 0 2px 8px rgba(0,0,0,0.35);
    }
    #hovercard.slop-hidden { display: none; }
    #hovercard .slop-hc-name { font-weight: 600; }
    #hovercard .slop-hc-kind {
      margin-left: 6px; padding: 0 5px; border-radius: 8px; font-size: 10px;
      background: var(--vscode-badge-background, #8883); color: var(--vscode-badge-foreground);
    }
    #hovercard code {
      display: block; margin-top: 3px; white-space: pre-wrap; word-break: break-word;
      font-family: var(--vscode-editor-font-family, ui-monospace, monospace);
      color: var(--vscode-textPreformat-foreground, inherit);
    }
    #hovercard .slop-hc-doc { margin-top: 3px; opacity: 0.85; }
    #hovercard .slop-hc-meta { margin-top: 4px; opacity: 0.65; }
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
  <div id="toolbar" class="slop-hidden" role="search">
    <input id="search" type="search" placeholder="Search nodes…  (/ to focus, Esc to clear)"
      aria-label="Search nodes" autocomplete="off" spellcheck="false" />
    <div id="kind-chips" class="slop-chip-row" aria-label="Filter by kind"></div>
    <div id="path-chips" class="slop-chip-row" aria-label="Filter by path"></div>
    <div id="var-chips" class="slop-chip-row" aria-label="Highlight a variable's data flow"></div>
    <button id="isolate" class="slop-btn" type="button" disabled
      title="Show only this node and its neighbors">Isolate</button>
    <button id="reset" class="slop-btn slop-hidden" type="button"
      title="Show the whole diagram again">Show all</button>
    <button id="legend-toggle" class="slop-btn" type="button" aria-expanded="false"
      title="Explain the colors and line styles">Legend</button>
  </div>
  <aside id="legend" class="slop-hidden" aria-label="Diagram legend"></aside>
  <div id="hovercard" class="slop-hidden" role="tooltip"></div>
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
