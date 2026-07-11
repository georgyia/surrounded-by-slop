import * as assert from "node:assert";
import type { DiagramData } from "@surrounded-by-slop/webview";
import * as vscode from "vscode";
import type { SlopApi } from "../../extension.js";
import { test, withTimeout } from "../harness.js";

const EXTENSION_ID = "georgyia.surrounded-by-slop";

async function getApi(): Promise<SlopApi> {
  const extension = vscode.extensions.getExtension<SlopApi>(EXTENSION_ID);
  assert.ok(extension, `extension ${EXTENSION_ID} is present`);
  return extension.activate();
}

test("Visualize File opens a diagram panel beside the editor and completes the handshake", async () => {
  const api = await getApi();

  const document = await vscode.workspace.openTextDocument({
    language: "typescript",
    content: "export function a() { b(); }\nfunction b() {}\n",
  });
  await vscode.window.showTextDocument(document, vscode.ViewColumn.One);

  // Resolves only once the host has dispatched the diagram to a *ready* webview,
  // proving the panel loaded its CSP'd bundle and completed the version handshake.
  const visualized = new Promise<DiagramData>((resolve) => {
    const subscription = api.onDidVisualize((diagram) => {
      subscription.dispose();
      resolve(diagram);
    });
  });

  await vscode.commands.executeCommand("slop.visualizeFile");
  const diagram = await withTimeout(visualized, 20_000, "diagram round-trip");

  // The analyzed graph made it across: module + two functions, at least.
  assert.ok(
    diagram.graph.nodes.length >= 3,
    `expected the analyzed nodes, got ${diagram.graph.nodes.length}`,
  );
  assert.ok(diagram.layout.nodes.length > 0, "layout positions were computed");

  const tabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs);
  assert.ok(
    tabs.some((tab) => tab.label === "Slop Diagram"),
    "a 'Slop Diagram' tab is open",
  );
});
