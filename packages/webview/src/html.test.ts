import { describe, expect, it } from "vitest";
import { buildDiagramHtml, createNonce } from "./html.js";

const options = {
  scriptUri: "https://file.vscode-cdn.net/webview/dist/webview.js",
  cspSource: "https://file.vscode-cdn.net",
  nonce: "abc123",
  theme: "dark",
} as const;

describe("buildDiagramHtml", () => {
  const html = buildDiagramHtml(options);

  it("declares a Content-Security-Policy", () => {
    expect(html).toContain('http-equiv="Content-Security-Policy"');
    expect(html).toContain("default-src 'none'");
  });

  it("only runs scripts bearing the nonce — never unsafe-inline", () => {
    expect(html).toContain(`script-src 'nonce-${options.nonce}'`);
    expect(html).not.toContain("unsafe-inline");
    expect(html).not.toContain("unsafe-eval");
    // The one script tag carries the nonce and points at the bundled webview.
    expect(html).toContain(`<script nonce="${options.nonce}" src="${options.scriptUri}"></script>`);
  });

  it("scopes local resources (styles, images, fonts) to the webview origin", () => {
    expect(html).toContain(`style-src ${options.cspSource} 'nonce-${options.nonce}'`);
    expect(html).toContain(`img-src ${options.cspSource} data:`);
    expect(html).toContain(`font-src ${options.cspSource}`);
  });

  it("carries the initial theme so the first paint matches the editor", () => {
    expect(html).toContain('data-theme="dark"');
  });

  it("includes the workspace fold toggle, hidden until a workspace map arrives", () => {
    expect(html).toContain('id="workspace-view"');
    expect(html).toContain('id="workspace-view" class="slop-btn slop-hidden"');
  });
});

describe("createNonce", () => {
  it("produces a fresh 32-hex-character token each call", () => {
    const a = createNonce();
    const b = createNonce();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
});
