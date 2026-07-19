import * as assert from "node:assert";
import type { DiagramData } from "@surrounded-by-slop/webview";
import * as vscode from "vscode";
import type { SlopApi } from "../../extension.js";
import { test, withTimeout } from "../harness.js";

const EXTENSION_ID = "georgyia.surrounded-by-slop";

async function visualizeOnce(api: SlopApi): Promise<DiagramData> {
  const visualized = new Promise<DiagramData>((resolve) => {
    const subscription = api.onDidVisualize((diagram) => {
      subscription.dispose();
      resolve(diagram);
    });
  });
  await vscode.commands.executeCommand("slop.visualizeFile");
  return withTimeout(visualized, 20_000, "visualize");
}

test("slop.showExternalModules toggles external package nodes (applies on next render)", async () => {
  const extension = vscode.extensions.getExtension<SlopApi>(EXTENSION_ID);
  assert.ok(extension, "extension present");
  const api = await extension.activate();
  const config = vscode.workspace.getConfiguration("slop");

  const document = await vscode.workspace.openTextDocument({
    language: "typescript",
    content: "import * as fs from 'node:fs';\nexport function f() {\n  return fs;\n}\n",
  });
  await vscode.window.showTextDocument(document, vscode.ViewColumn.One);

  try {
    await config.update("showExternalModules", true, vscode.ConfigurationTarget.Global);
    const shown = await visualizeOnce(api);
    assert.ok(
      shown.graph.nodes.some((node) => node.external === true),
      "an external node is present when the setting is on",
    );

    await config.update("showExternalModules", false, vscode.ConfigurationTarget.Global);
    const hidden = await visualizeOnce(api);
    assert.ok(
      !hidden.graph.nodes.some((node) => node.external === true),
      "external nodes are gone when the setting is off",
    );
    assert.ok(
      hidden.graph.nodes.some((node) => node.name === "f"),
      "internal declarations still render",
    );
  } finally {
    await config.update("showExternalModules", undefined, vscode.ConfigurationTarget.Global);
  }
});

test("workspace map hides externals by default; single-file view shows them", async () => {
  const extension = vscode.extensions.getExtension<SlopApi>(EXTENSION_ID);
  assert.ok(extension, "extension present");
  const api = await extension.activate();
  const config = vscode.workspace.getConfiguration("slop");
  // Guard against leakage from other tests: the whole point is the *unset* default.
  await config.update("showExternalModules", undefined, vscode.ConfigurationTarget.Global);

  // epsilon.ts imports "react". On its own file view that external is the point.
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0];
  assert.ok(workspaceRoot, "expected an open workspace folder");
  const epsilon = vscode.Uri.joinPath(workspaceRoot.uri, "epsilon.ts");
  const document = await vscode.workspace.openTextDocument(epsilon);
  await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
  const fileView = await visualizeOnce(api);
  assert.ok(
    fileView.graph.nodes.some((node) => node.external === true),
    "single-file view shows external nodes by default",
  );

  // On the workspace overview the same react node is a fan-in hub — hidden.
  const mapView = new Promise<DiagramData>((resolve) => {
    const subscription = api.onDidVisualize((diagram) => {
      subscription.dispose();
      resolve(diagram);
    });
  });
  await api.visualizeWorkspace(new vscode.CancellationTokenSource().token);
  const map = await withTimeout(mapView, 20_000, "workspace map");
  assert.ok(
    !map.graph.nodes.some((node) => node.external === true),
    "workspace map hides external nodes by default",
  );
});
