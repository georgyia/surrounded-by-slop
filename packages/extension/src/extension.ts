import * as vscode from "vscode";
import { visualizeActiveFile } from "./commands/visualizeFile.js";

/**
 * Activation stays cheap: it only registers commands. Anything heavy — the
 * analysis core, the layout engine, the TypeScript compiler — is imported
 * lazily inside the command handlers, so opening the editor never pays for a
 * feature the user hasn't reached yet.
 */
export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("slop.visualizeFile", () => visualizeActiveFile()),
  );
}

export function deactivate(): void {
  // Everything is registered through context.subscriptions and disposed for us.
}
