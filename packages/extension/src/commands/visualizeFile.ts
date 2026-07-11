import * as vscode from "vscode";
import type { DiagramView } from "../panel/diagramView.js";

/** VS Code language ids the TypeScript adapter understands, and their file suffix. */
const LANGUAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  typescript: ".ts",
  typescriptreact: ".tsx",
  javascript: ".js",
  javascriptreact: ".jsx",
};

/**
 * Analyze the file in the active editor and show it as a diagram beside the
 * editor. The heavy analysis core and layout engine are imported lazily here,
 * off the activation path.
 */
export async function visualizeActiveFile(view: DiagramView): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (editor === undefined) {
    void vscode.window.showInformationMessage(
      "Surrounded by Slop: open a TypeScript or JavaScript file to visualize it.",
    );
    return;
  }

  const document = editor.document;
  const suffix = LANGUAGE_EXTENSIONS[document.languageId];
  if (suffix === undefined) {
    void vscode.window.showInformationMessage(
      `Surrounded by Slop can't visualize ${document.languageId} yet — open a TS/JS file.`,
    );
    return;
  }

  const path = document.isUntitled
    ? `untitled${suffix}`
    : vscode.workspace.asRelativePath(document.uri);

  try {
    const { analyzeTypeScriptProject, layoutGraph } = await import("@surrounded-by-slop/core");
    const { graph } = analyzeTypeScriptProject([{ path, text: document.getText() }]);
    const layout = await layoutGraph(graph);
    view.show({ title: path, graph, layout });
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Surrounded by Slop couldn't visualize ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
