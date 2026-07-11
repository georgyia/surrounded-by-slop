import * as assert from "node:assert";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as vscode from "vscode";
import type { SlopApi } from "../../extension.js";
import { test } from "../harness.js";

const EXTENSION_ID = "georgyia.surrounded-by-slop";
const FIXTURE = resolve(__dirname, "../../../test-fixtures/sample.ts");

async function visualizeFixture(): Promise<SlopApi> {
  const extension = vscode.extensions.getExtension<SlopApi>(EXTENSION_ID);
  assert.ok(extension, "extension present");
  const api = await extension.activate();
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(FIXTURE));
  await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
  await vscode.commands.executeCommand("slop.visualizeFile");
  return api;
}

test("exports the current diagram in every format", async () => {
  const api = await visualizeFixture();
  const dir = mkdtempSync(join(tmpdir(), "slop-export-"));

  const cases: ReadonlyArray<readonly [string, RegExp]> = [
    ["drawio", /<mxGraphModel|<mxCell/],
    ["svg", /<svg\b/],
    ["mmd", /flowchart|classDiagram/],
    ["json", /"schemaVersion"/],
  ];
  for (const [extension, signature] of cases) {
    const target = vscode.Uri.file(join(dir, `out.${extension}`));
    await api.exportDiagram(target);
    const content = readFileSync(target.fsPath, "utf8");
    assert.match(content, signature, `.${extension} export has the expected shape`);
  }
});

test("copies the diagram as Mermaid to the clipboard", async () => {
  await visualizeFixture();
  await vscode.env.clipboard.writeText("<none>");
  await vscode.commands.executeCommand("slop.copyMermaid");
  const clipboard = await vscode.env.clipboard.readText();
  assert.match(clipboard, /flowchart/, "clipboard holds a Mermaid flowchart");
  assert.ok(clipboard.includes("alpha"), "the Mermaid mentions the fixture's declarations");
});
