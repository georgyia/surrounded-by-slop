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
