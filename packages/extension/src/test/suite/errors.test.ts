import * as assert from "node:assert";
import type { DiagramData } from "@surrounded-by-slop/webview";
import * as vscode from "vscode";
import type { SlopApi } from "../../extension.js";
import type { LogRecord } from "../../log.js";
import { test, withTimeout } from "../harness.js";

const EXTENSION_ID = "georgyia.surrounded-by-slop";

test("a broken file yields a partial diagram and a logged warning, not a crash", async () => {
  const extension = vscode.extensions.getExtension<SlopApi>(EXTENSION_ID);
  assert.ok(extension, "extension present");
  const api = await extension.activate();

  const logs: LogRecord[] = [];
  const logSubscription = api.onDidLog((record) => logs.push(record));

  const document = await vscode.workspace.openTextDocument({
    language: "typescript",
    content: "export function ok() {}\nfunction broken( {\n",
  });
  await vscode.window.showTextDocument(document, vscode.ViewColumn.One);

  const visualized = new Promise<DiagramData>((resolve) => {
    const subscription = api.onDidVisualize((diagram) => {
      subscription.dispose();
      resolve(diagram);
    });
  });
  await vscode.commands.executeCommand("slop.visualizeFile");
  const diagram = await withTimeout(visualized, 10_000, "diagram round-trip");
  logSubscription.dispose();

  // Degraded, not dead: a partial graph still reached the webview.
  assert.ok(diagram.graph.nodes.length >= 1, "a partial graph was produced");
  // And the syntax error was surfaced as a warning in the output channel.
  assert.ok(
    logs.some((record) => record.level === "warn"),
    `expected a logged warning, got ${JSON.stringify(logs)}`,
  );
});
