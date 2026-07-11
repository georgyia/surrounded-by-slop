import * as vscode from "vscode";

/** VS Code language ids the TypeScript adapter understands, and their file suffix. */
const LANGUAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  typescript: ".ts",
  typescriptreact: ".tsx",
  javascript: ".js",
  javascriptreact: ".jsx",
};

/**
 * Analyze the file in the active editor.
 *
 * This first cut reports what it found; the interactive diagram panel lands in
 * SBS-042 and takes over from the notification. Keeping the command real from
 * day one proves the host↔core wiring end to end (and that pulling in the
 * TypeScript compiler stays off the activation path — it is imported here,
 * lazily, not at activation).
 */
export async function visualizeActiveFile(): Promise<void> {
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

  const { analyzeTypeScriptProject } = await import("@surrounded-by-slop/core");
  const path = document.isUntitled
    ? `untitled${suffix}`
    : vscode.workspace.asRelativePath(document.uri);
  const { graph, diagnostics } = analyzeTypeScriptProject([{ path, text: document.getText() }]);

  const callable = graph.nodes.filter(
    (node) => node.kind === "function" || node.kind === "method",
  ).length;
  const calls = graph.edges.filter((edge) => edge.kind === "calls").length;
  const trailer = diagnostics.length > 0 ? ` · ${diagnostics.length} diagnostic(s)` : "";
  void vscode.window.showInformationMessage(
    `${path}: ${graph.nodes.length} symbols, ${callable} functions, ${calls} calls${trailer}.`,
  );
}
