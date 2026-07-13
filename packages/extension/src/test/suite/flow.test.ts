import * as assert from "node:assert";
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

async function openFlowSample(): Promise<vscode.TextEditor> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "a workspace folder is open");
  const uri = vscode.Uri.joinPath(folder.uri, "flow-sample.ts");
  const document = await vscode.workspace.openTextDocument(uri);
  return vscode.window.showTextDocument(document, vscode.ViewColumn.One);
}

test("Visualize Function Flow charts the function under the cursor", async () => {
  const api = await getApi();
  const editor = await openFlowSample();
  // Cursor on the `for` line, inside pickLane's body.
  editor.selection = new vscode.Selection(4, 4, 4, 4);

  const visualized = nextVisualize(api);
  await vscode.commands.executeCommand("slop.visualizeFunctionFlow");
  const diagram = await withTimeout(visualized, 20_000, "function flow round-trip");

  assert.ok(diagram.flow, "the diagram carries its control-flow graph");
  assert.strictEqual(diagram.flow.name, "pickLane", "charts the enclosing function");
  assert.ok(diagram.title.includes("flow"), "titled as a flow chart");

  // Condition-labeled branches and a loop back-edge are present.
  const kinds = new Set(diagram.flow.edges.map((edge) => edge.kind));
  for (const expected of ["true", "false", "back"]) {
    assert.ok(kinds.has(expected as never), `flow has a ${expected} edge`);
  }
  // Every block got a layout box (the synthetic graph mirrors the CFG).
  const positioned = new Set(diagram.layout.nodes.map((node) => node.id));
  for (const block of diagram.flow.blocks) {
    assert.ok(positioned.has(block.id), `block ${block.id} has a layout position`);
  }

  // The def-use overlay rides along (SBS-072): pickLane's variables are listed.
  assert.ok(diagram.dataflow, "the diagram carries the function's dataflow");
  const variables = new Set(diagram.dataflow.variables.map((variable) => variable.name));
  for (const expected of ["load", "attempt"]) {
    assert.ok(variables.has(expected), `dataflow lists '${expected}'`);
  }
});

test("the Mermaid export of a flow diagram matches the interactive view", async () => {
  const api = await getApi();
  const editor = await openFlowSample();
  editor.selection = new vscode.Selection(4, 4, 4, 4);

  const visualized = nextVisualize(api);
  await vscode.commands.executeCommand("slop.visualizeFunctionFlow");
  const diagram = await withTimeout(visualized, 20_000, "function flow round-trip");
  assert.ok(diagram.flow, "flow present");

  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "workspace folder");
  const target = vscode.Uri.joinPath(folder.uri, "flow-export.mmd");
  try {
    await api.exportDiagram(target);
    const exported = new TextDecoder().decode(await vscode.workspace.fs.readFile(target));
    assert.ok(exported.startsWith("flowchart TD"), "mermaid flowchart header");
    // The export mirrors the view's structure: every block id and the labels.
    for (const block of diagram.flow.blocks) {
      assert.ok(exported.includes(block.id), `mermaid includes block ${block.id}`);
    }
    assert.ok(exported.includes("|true|"), "true branch labeled");
    assert.ok(exported.includes("|false|"), "false branch labeled");
    assert.ok(exported.includes("-.->|loop|"), "loop back-edge dotted and labeled");
  } finally {
    try {
      await vscode.workspace.fs.delete(target);
    } catch {
      // already gone
    }
  }
});

test("Function Flow outside any function points the user at a function body", async () => {
  const api = await getApi();
  const editor = await openFlowSample();
  // Line 0 is the function signature's line... use the blank line between functions.
  editor.selection = new vscode.Selection(11, 0, 11, 0);

  let visualized = false;
  const subscription = api.onDidVisualize(() => {
    visualized = true;
  });
  await vscode.commands.executeCommand("slop.visualizeFunctionFlow");
  await new Promise((resolve) => setTimeout(resolve, 300));
  subscription.dispose();
  assert.strictEqual(visualized, false, "no diagram is produced outside a function");
});
