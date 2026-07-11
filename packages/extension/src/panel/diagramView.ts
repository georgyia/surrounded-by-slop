import type { SourceSpan } from "@surrounded-by-slop/core";
import type {
  ColorTheme,
  DiagramData,
  HostToWebview,
  WebviewToHost,
} from "@surrounded-by-slop/webview";
import { buildDiagramHtml, createNonce, PROTOCOL_VERSION } from "@surrounded-by-slop/webview";
import * as vscode from "vscode";
import type { Logger } from "../log.js";

export const DIAGRAM_VIEW_TYPE = "slop.diagram";

function currentTheme(): ColorTheme {
  const kind = vscode.window.activeColorTheme.kind;
  return kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast
    ? "dark"
    : "light";
}

/** A 1-based IR span as a 0-based editor range, clamped so an edited (shorter) file never throws. */
function clampSpanToDocument(span: SourceSpan, document: vscode.TextDocument): vscode.Range {
  const clamp = (value: number, max: number): number => Math.max(0, Math.min(value, max));
  const lastLine = Math.max(0, document.lineCount - 1);
  const startLine = clamp(span.startLine - 1, lastLine);
  const endLine = clamp(span.endLine - 1, lastLine);
  const startCharacter = clamp(span.startCol - 1, document.lineAt(startLine).text.length);
  const endCharacter = clamp(span.endCol - 1, document.lineAt(endLine).text.length);
  return new vscode.Range(startLine, startCharacter, endLine, endCharacter);
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
  private currentFit = true;
  private sourceUri: vscode.Uri | undefined;
  private ready = false;
  private wasVisible = true;
  private readonly panelDisposables: vscode.Disposable[] = [];
  private readonly didVisualize = new vscode.EventEmitter<DiagramData>();

  /** Fires once a diagram has been dispatched to a ready webview (host↔webview round-trip complete). */
  readonly onDidVisualize = this.didVisualize.event;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly logger: Logger,
  ) {}

  /** Show (or update) the diagram, creating/revealing the panel beside the editor. */
  show(diagram: DiagramData, source: vscode.Uri): void {
    // Refreshing the same file keeps the current pan/zoom; a different file fits anew.
    this.currentFit = this.sourceUri?.toString() !== source.toString();
    this.current = diagram;
    this.sourceUri = source;
    if (this.panel === undefined) {
      this.panel = this.create();
    } else {
      this.panel.reveal(vscode.ViewColumn.Beside, true);
    }
    if (this.ready) {
      this.dispatch(diagram, this.currentFit);
    }
  }

  /** Re-adopt a panel VS Code restored after a window reload (see the serializer). */
  restore(panel: vscode.WebviewPanel, state: unknown): void {
    this.panel = panel;
    // Recover the graph so click-to-source still resolves after a reload; the
    // webview restores its own rendering from `getState`, so we don't resend.
    const restored = (state as { diagram?: DiagramData } | undefined)?.diagram;
    if (restored !== undefined) {
      this.current = restored;
    }
    this.adopt(panel);
  }

  /** Open the declaration a node points at, selecting its source range. */
  async revealNode(nodeId: string, toSide: boolean): Promise<void> {
    const span = this.current?.graph.nodes.find((node) => node.id === nodeId)?.span;
    if (span === undefined) {
      return; // external or synthesized nodes have no source to open
    }
    const uri = this.sourceUri ?? this.workspaceUri(span.file);
    if (uri === undefined) {
      return;
    }
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      const range = clampSpanToDocument(span, document);
      const editor = await vscode.window.showTextDocument(document, {
        viewColumn: toSide ? vscode.ViewColumn.Beside : vscode.ViewColumn.One,
        selection: range,
      });
      editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    } catch (error) {
      this.logger.report(`Surrounded by Slop couldn't open ${span.file}.`, error);
    }
  }

  private workspaceUri(file: string): vscode.Uri | undefined {
    const folder = vscode.workspace.workspaceFolders?.[0];
    return folder === undefined ? undefined : vscode.Uri.joinPath(folder.uri, file);
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
          this.dispatch(this.current, true); // a freshly booted webview fits to view
        }
        break;
      }
      case "revealNode":
        void this.revealNode(message.nodeId, message.toSide);
        break;
      case "error":
        this.logger.warn(`webview: ${message.message}`);
        break;
    }
  }

  private dispatch(diagram: DiagramData, fit: boolean): void {
    this.post({ type: "render", diagram, theme: currentTheme(), fit });
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
