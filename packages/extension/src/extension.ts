import type { DiagramData } from "@surrounded-by-slop/webview";
import * as vscode from "vscode";
import { VisualizationController } from "./controller.js";
import { Logger, type LogRecord } from "./log.js";
import { DIAGRAM_VIEW_TYPE, DiagramView } from "./panel/diagramView.js";

/** What `activate` returns — an observation/automation surface (used by integration tests). */
export interface SlopApi {
  readonly onDidVisualize: vscode.Event<DiagramData>;
  readonly onDidLog: vscode.Event<LogRecord>;
  readonly revealNode: (nodeId: string, toSide?: boolean) => Promise<void>;
  readonly exportDiagram: (target: vscode.Uri) => Promise<void>;
  readonly visualizeWorkspace: (token?: vscode.CancellationToken) => Promise<void>;
}

/**
 * Activation stays cheap: it wires commands, the panel serializer and the
 * live-refresh listeners. Anything heavy — the analysis core, the layout
 * engine, the TypeScript compiler — is imported lazily inside the controller,
 * so opening the editor never pays for a feature the user hasn't reached yet.
 */
export function activate(context: vscode.ExtensionContext): SlopApi {
  const logger = new Logger();
  const view = new DiagramView(context.extensionUri, logger);
  const controller = new VisualizationController(view, logger);

  context.subscriptions.push(
    logger,
    view,
    controller,
    vscode.commands.registerCommand("slop.visualizeFile", () => controller.visualizeActive()),
    vscode.commands.registerCommand("slop.visualizeFunctionFlow", () =>
      controller.visualizeFunctionFlow(),
    ),
    vscode.commands.registerCommand("slop.visualizeWorkspace", () =>
      controller.visualizeWorkspace(),
    ),
    vscode.commands.registerCommand("slop.togglePin", () => controller.togglePin()),
    vscode.commands.registerCommand("slop.followActiveEditor", () => controller.toggleFollow()),
    vscode.commands.registerCommand("slop.exportDiagram", () => controller.exportInteractive()),
    // The diagram's native right-click menu: VS Code hands the node's
    // data-vscode-context object to the command (see render.ts).
    vscode.commands.registerCommand(
      "slop.contextJumpToSource",
      (context?: { slopNodeId?: string }) => {
        if (context?.slopNodeId !== undefined) {
          void view.revealNode(context.slopNodeId, false);
        }
      },
    ),
    vscode.commands.registerCommand(
      "slop.contextOpenToSide",
      (context?: { slopNodeId?: string }) => {
        if (context?.slopNodeId !== undefined) {
          void view.revealNode(context.slopNodeId, true);
        }
      },
    ),
    vscode.commands.registerCommand("slop.contextIsolate", (context?: { slopNodeId?: string }) => {
      if (context?.slopNodeId !== undefined) {
        void controller.isolate(context.slopNodeId);
      }
    }),
    vscode.commands.registerCommand("slop.copyMermaid", () => controller.copyMermaid()),
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
    exportDiagram: (target) => controller.exportTo(target),
    visualizeWorkspace: (token) => controller.visualizeWorkspace(token),
  };
}

export function deactivate(): void {
  // Everything is registered through context.subscriptions and disposed for us.
}
