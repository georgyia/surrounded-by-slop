import * as assert from "node:assert";
import * as vscode from "vscode";
import { test } from "../harness.js";

const EXTENSION_ID = "georgyia.surrounded-by-slop";

test("activates and registers the Visualize File command", async () => {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, `extension ${EXTENSION_ID} is present`);

  const started = Date.now();
  await extension.activate();
  // Activation only registers commands — the heavy analysis core is imported
  // lazily by the handler, so this should be near-instant.
  console.log(`  activate() took ${Date.now() - started}ms`);
  assert.ok(extension.isActive, "extension reports active");

  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes("slop.visualizeFile"), "slop.visualizeFile is registered");
});

test("Visualize File analyzes the active TypeScript editor without throwing", async () => {
  const document = await vscode.workspace.openTextDocument({
    language: "typescript",
    content: "export function greet(name: string) {\n  return 'hi ' + name;\n}\n\ngreet('slop');\n",
  });
  await vscode.window.showTextDocument(document);
  // Exercises the full host→core path (dynamic import, analysis, notification).
  await vscode.commands.executeCommand("slop.visualizeFile");
});
