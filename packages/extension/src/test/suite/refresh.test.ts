import * as assert from "node:assert";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DiagramData } from "@surrounded-by-slop/webview";
import * as vscode from "vscode";
import type { SlopApi } from "../../extension.js";
import { test, withTimeout } from "../harness.js";

const EXTENSION_ID = "georgyia.surrounded-by-slop";

async function getApi(): Promise<SlopApi> {
  const extension = vscode.extensions.getExtension<SlopApi>(EXTENSION_ID);
  assert.ok(extension, "extension present");
  return extension.activate();
}

function nextVisualize(api: SlopApi): Promise<DiagramData> {
  return new Promise((resolve) => {
    const subscription = api.onDidVisualize((diagram) => {
      subscription.dispose();
      resolve(diagram);
    });
  });
}

async function tempFile(name: string, content: string): Promise<vscode.TextDocument> {
  const file = join(mkdtempSync(join(tmpdir(), "slop-")), name);
  writeFileSync(file, content);
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
  return document;
}

test("saving the visualized file refreshes the diagram", async () => {
  const api = await getApi();
  const document = await tempFile("refresh.ts", "export function one() {}\n");

  const first = nextVisualize(api);
  await vscode.commands.executeCommand("slop.visualizeFile");
  const v1 = await withTimeout(first, 20_000, "initial visualize");
  assert.ok(
    v1.graph.nodes.some((node) => node.name === "one"),
    "initial diagram shows 'one'",
  );

  const refreshed = nextVisualize(api);
  const edit = new vscode.WorkspaceEdit();
  edit.insert(
    document.uri,
    new vscode.Position(document.lineCount, 0),
    "export function two() {}\n",
  );
  await vscode.workspace.applyEdit(edit);
  await document.save();

  const v2 = await withTimeout(refreshed, 20_000, "refresh on save");
  assert.ok(
    v2.graph.nodes.some((node) => node.name === "two"),
    "the saved change ('two') is now in the diagram",
  );
});

test("a pinned diagram does not refresh when its file is saved", async () => {
  const api = await getApi();
  const document = await tempFile("pinned.ts", "export function alpha() {}\n");

  const first = nextVisualize(api);
  await vscode.commands.executeCommand("slop.visualizeFile");
  await withTimeout(first, 20_000, "initial visualize");

  await vscode.commands.executeCommand("slop.togglePin");
  try {
    let refreshed = false;
    const subscription = api.onDidVisualize(() => {
      refreshed = true;
    });
    const edit = new vscode.WorkspaceEdit();
    edit.insert(
      document.uri,
      new vscode.Position(document.lineCount, 0),
      "export function beta() {}\n",
    );
    await vscode.workspace.applyEdit(edit);
    await document.save();
    await new Promise((resolve) => setTimeout(resolve, 800)); // longer than the 300ms debounce
    subscription.dispose();
    assert.strictEqual(refreshed, false, "a pinned diagram must not refresh on save");
  } finally {
    await vscode.commands.executeCommand("slop.togglePin"); // restore the default for later tests
  }
});
