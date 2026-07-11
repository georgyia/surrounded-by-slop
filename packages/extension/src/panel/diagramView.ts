import type {
  ColorTheme,
  DiagramData,
  HostToWebview,
  WebviewToHost,
} from "@surrounded-by-slop/webview";
import { buildDiagramHtml, createNonce, PROTOCOL_VERSION } from "@surrounded-by-slop/webview";
import * as vscode from "vscode";

export const DIAGRAM_VIEW_TYPE = "slop.diagram";

function currentTheme(): ColorTheme {
  const kind = vscode.window.activeColorTheme.kind;
  return kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast
    ? "dark"
    : "light";
}

/**
 * Owns the single diagram webview panel: creating it beside the editor, feeding
 * it graphs, restoring it after a reload, and keeping its theme in sync.
 *
 * Delivery is gated on the webview's `ready` handshake and the current diagram
 * is re-sent whenever a (possibly reloaded) webview announces readiness, so a
 * dropped early message can never leave the panel blank.
 */
export class DiagramView {
  private panel: vscode.WebviewPanel | undefined;
  private current: DiagramData | undefined;
  private ready = false;
  private wasVisible = true;
  private readonly panelDisposables: vscode.Disposable[] = [];
  private readonly didVisualize = new vscode.EventEmitter<DiagramData>();

  /** Fires once a diagram has been dispatched to a ready webview (host↔webview round-trip complete). */
  readonly onDidVisualize = this.didVisualize.event;

  constructor(private readonly extensionUri: vscode.Uri) {}

  /** Show (or update) the diagram, creating/revealing the panel beside the editor. */
  show(diagram: DiagramData): void {
    this.current = diagram;
    if (this.panel === undefined) {
      this.panel = this.create();
    } else {
      this.panel.reveal(vscode.ViewColumn.Beside, true);
    }
    if (this.ready) {
      this.dispatch(diagram);
    }
  }

  /** Re-adopt a panel VS Code restored after a window reload (see the serializer). */
  restore(panel: vscode.WebviewPanel): void {
    this.panel = panel;
    this.adopt(panel);
    // The webview restores its own content from `getState`; nothing to resend.
  }

  dispose(): void {
    this.didVisualize.dispose();
    this.disposePanel();
  }

  private create(): vscode.WebviewPanel {
    const panel = vscode.window.createWebviewPanel(
      DIAGRAM_VIEW_TYPE,
      "Slop Diagram",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        // Deliberately off: a hidden panel is torn down and restores from the
        // serialized graph, so we never pay to retain a heavy DOM in the background.
        retainContextWhenHidden: false,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist")],
      },
    );
    this.adopt(panel);
    return panel;
  }

  private adopt(panel: vscode.WebviewPanel): void {
    this.disposePanel();
    this.ready = false;
    this.wasVisible = panel.visible;
    panel.webview.html = this.html(panel.webview);

    this.panelDisposables.push(
      panel.onDidDispose(() => {
        if (this.panel === panel) {
          this.panel = undefined;
          this.ready = false;
        }
      }),
      panel.webview.onDidReceiveMessage((message: WebviewToHost) => this.onMessage(message)),
      panel.onDidChangeViewState(() => {
        // A hidden→visible transition means the webview reloaded: it will send a
        // fresh `ready`, so drop the stale flag and let that resend the diagram.
        if (panel.visible && !this.wasVisible) {
          this.ready = false;
        }
        this.wasVisible = panel.visible;
      }),
      vscode.window.onDidChangeActiveColorTheme(() => {
        this.post({ type: "theme", theme: currentTheme() });
      }),
    );
  }

  private onMessage(message: WebviewToHost): void {
    switch (message.type) {
      case "ready": {
        if (message.protocol !== PROTOCOL_VERSION) {
          void vscode.window.showErrorMessage(
            "Surrounded by Slop: the diagram view is out of date. Reload the window to update it.",
          );
          return;
        }
        this.ready = true;
        if (this.current !== undefined) {
          this.dispatch(this.current);
        }
        break;
      }
      // revealNode (SBS-044) and error (SBS-051) are handled when those land.
    }
  }

  private dispatch(diagram: DiagramData): void {
    this.post({ type: "render", diagram, theme: currentTheme() });
    this.didVisualize.fire(diagram);
  }

  private post(message: HostToWebview): void {
    void this.panel?.webview.postMessage(message);
  }

  private html(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview.js"),
    );
    return buildDiagramHtml({
      scriptUri: scriptUri.toString(),
      cspSource: webview.cspSource,
      nonce: createNonce(),
      theme: currentTheme(),
    });
  }

  private disposePanel(): void {
    for (const disposable of this.panelDisposables.splice(0)) {
      disposable.dispose();
    }
  }
}
