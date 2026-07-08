import type * as vscode from "vscode";

/**
 * Deliberately minimal: the extension surface (commands, webview panel)
 * arrives with the first visualization feature. The scaffold exists so the
 * project builds, typechecks and packages a valid VSIX from day one.
 */
export function activate(_context: vscode.ExtensionContext): void {
  // No activation work yet.
}

export function deactivate(): void {
  // Nothing to dispose yet.
}
