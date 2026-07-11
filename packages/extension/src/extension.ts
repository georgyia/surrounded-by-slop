import type { DiagramData } from "@surrounded-by-slop/webview";
import * as vscode from "vscode";
import { visualizeActiveFile } from "./commands/visualizeFile.js";
import { Logger, type LogRecord } from "./log.js";
import { DIAGRAM_VIEW_TYPE, DiagramView } from "./panel/diagramView.js";

/** What `activate` returns — an observation/automation surface (used by integration tests). */
export interface SlopApi {
  readonly onDidVisualize: vscode.Event<DiagramData>;
  readonly onDidLog: vscode.Event<LogRecord>;
  readonly revealNode: (nodeId: string, toSide?: boolean) => Promise<void>;
}

/**
 * Activation stays cheap: it wires commands and the panel serializer. Anything
 * heavy — the analysis core, the layout engine, the TypeScript compiler — is
 * imported lazily inside the command handlers, so opening the editor never pays
 * for a feature the user hasn't reached yet.
 */
export function activate(context: vscode.ExtensionContext): SlopApi {
  const logger = new Logger();
  const view = new DiagramView(context.extensionUri, logger);

  context.subscriptions.push(
    logger,
    view,
    vscode.commands.registerCommand("slop.visualizeFile", () => visualizeActiveFile(view, logger)),
    // Restore the diagram panel after a window reload.
    vscode.window.registerWebviewPanelSerializer(DIAGRAM_VIEW_TYPE, {
      deserializeWebviewPanel(panel, state: unknown) {
        view.restore(panel, state);
        return Promise.resolve();
      },
    }),
  );

  return {
    onDidVisualize: view.onDidVisualize,
    onDidLog: logger.onDidLog,
    revealNode: (nodeId, toSide = false) => view.revealNode(nodeId, toSide),
  };
}

export function deactivate(): void {
  // Everything is registered through context.subscriptions and disposed for us.
}
