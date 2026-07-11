import * as assert from "node:assert";
import { resolve } from "node:path";
import type { DiagramData } from "@surrounded-by-slop/webview";
import * as vscode from "vscode";
import type { SlopApi } from "../../extension.js";
import { test, withTimeout } from "../harness.js";

const EXTENSION_ID = "georgyia.surrounded-by-slop";
// dist/test/suite/ → packages/extension/
const FIXTURE = resolve(__dirname, "../../../test-fixtures/sample.ts");

test("Visualize File renders the analyzed declarations of a real file", async () => {
  const extension = vscode.extensions.getExtension<SlopApi>(EXTENSION_ID);
  assert.ok(extension, "extension present");
  const api = await extension.activate();

  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(FIXTURE));
  await vscode.window.showTextDocument(document, vscode.ViewColumn.One);

  const visualized = new Promise<DiagramData>((resolve_) => {
    const subscription = api.onDidVisualize((diagram) => {
      subscription.dispose();
      resolve_(diagram);
    });
  });
  await vscode.commands.executeCommand("slop.visualizeFile");
  const diagram = await withTimeout(visualized, 10_000, "diagram round-trip");

  // Every declaration in the fixture made it into the graph the webview renders.
  const names = new Set(diagram.graph.nodes.map((node) => node.name));
  for (const expected of ["alpha", "beta", "Widget", "render"]) {
    assert.ok(
      names.has(expected),
      `diagram is missing '${expected}' (got ${[...names].join(", ")})`,
    );
  }
  // And every analyzed node has a position to draw at.
  const positioned = new Set(diagram.layout.nodes.map((node) => node.id));
  for (const node of diagram.graph.nodes) {
    assert.ok(positioned.has(node.id), `node '${node.name}' has no layout position`);
  }
});
