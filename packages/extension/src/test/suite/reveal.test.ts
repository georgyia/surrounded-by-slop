import * as assert from "node:assert";
import { resolve } from "node:path";
import type { DiagramData } from "@surrounded-by-slop/webview";
import * as vscode from "vscode";
import type { SlopApi } from "../../extension.js";
import { test, withTimeout } from "../harness.js";

const EXTENSION_ID = "georgyia.surrounded-by-slop";
const FIXTURE = resolve(__dirname, "../../../test-fixtures/sample.ts");

async function getApi(): Promise<SlopApi> {
  const extension = vscode.extensions.getExtension<SlopApi>(EXTENSION_ID);
  assert.ok(extension, "extension present");
  return extension.activate();
}

async function visualize(api: SlopApi, document: vscode.TextDocument): Promise<DiagramData> {
  await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
  const visualized = new Promise<DiagramData>((resolve_) => {
    const subscription = api.onDidVisualize((diagram) => {
      subscription.dispose();
      resolve_(diagram);
    });
  });
  await vscode.commands.executeCommand("slop.visualizeFile");
  return withTimeout(visualized, 20_000, "diagram round-trip");
}

test("revealing a node lands the cursor on its declaration", async () => {
  const api = await getApi();
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(FIXTURE));
  const diagram = await visualize(api, document);

  const beta = diagram.graph.nodes.find((node) => node.name === "beta");
  assert.ok(beta?.span, "beta has a source span");
  await api.revealNode(beta.id);

  const editor = vscode.window.activeTextEditor;
  assert.ok(editor, "an editor is active after reveal");
  assert.strictEqual(editor.document.uri.fsPath, FIXTURE, "revealed the fixture file");
  assert.strictEqual(editor.selection.start.line, beta.span.startLine - 1, "cursor on beta's line");
  assert.strictEqual(
    editor.selection.start.character,
    beta.span.startCol - 1,
    "cursor on beta's column",
  );
});

test("revealing a node whose span outran an edit clamps instead of throwing", async () => {
  const api = await getApi();
  const document = await vscode.workspace.openTextDocument({
    language: "typescript",
    content: "function first() {}\nfunction second() {}\nfunction third() {}\n",
  });
  const diagram = await visualize(api, document);
  const third = diagram.graph.nodes.find((node) => node.name === "third");
  assert.ok(third?.span, "third has a span");

  // Shrink the document so `third`'s span now points past its end.
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), "x\n");
  await vscode.workspace.applyEdit(edit);

  await api.revealNode(third.id); // must not throw
  const editor = vscode.window.activeTextEditor;
  assert.ok(editor, "an editor is active");
  assert.ok(
    editor.selection.start.line <= Math.max(0, editor.document.lineCount - 1),
    "selection clamped into the shrunken document",
  );
});
