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

test("Visualize Workspace shows a collapsed module map of the folder", async () => {
  const api = await getApi();
  const visualized = nextVisualize(api);
  await api.visualizeWorkspace(new vscode.CancellationTokenSource().token);
  const diagram = await withTimeout(visualized, 20_000, "workspace visualize");

  // Collapsed to modules — never individual functions by default.
  assert.ok(
    diagram.graph.nodes.every((node) => node.kind === "module" || node.kind === "folder"),
    "every node is a module or folder",
  );
  const names = diagram.graph.nodes.map((node) => node.name);
  for (const file of ["alpha.ts", "beta.ts", "gamma.ts"]) {
    assert.ok(names.includes(file), `the map includes ${file} (got ${names.join(", ")})`);
  }
});

test("a cancelled Visualize Workspace renders nothing", async () => {
  const api = await getApi();
  const source = new vscode.CancellationTokenSource();
  source.cancel();

  let visualized = false;
  const subscription = api.onDidVisualize(() => {
    visualized = true;
  });
  await api.visualizeWorkspace(source.token);
  await new Promise((resolve) => setTimeout(resolve, 300));
  subscription.dispose();

  assert.strictEqual(visualized, false, "a pre-cancelled workspace analysis produces no diagram");
});

test("Visualize Workspace ignores excluded folders and oversized files", async () => {
  const api = await getApi();
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "a workspace folder is open");
  const root = folder.uri;

  const excluded = vscode.Uri.joinPath(root, ".vscode-test", "leak.ts");
  const oversized = vscode.Uri.joinPath(root, "huge.generated.ts");
  const encoder = new TextEncoder();
  await vscode.workspace.fs.writeFile(excluded, encoder.encode("export function leaked() {}\n"));
  // >512 KB of valid TypeScript: analyzed, it would add a module; it should be skipped.
  await vscode.workspace.fs.writeFile(
    oversized,
    encoder.encode(`export function huge() {}\n${"// pad\n".repeat(90_000)}`),
  );

  try {
    const visualized = nextVisualize(api);
    await api.visualizeWorkspace(new vscode.CancellationTokenSource().token);
    const diagram = await withTimeout(visualized, 20_000, "workspace visualize");
    const names = new Set(diagram.graph.nodes.map((node) => node.name));

    assert.ok(names.has("alpha.ts"), "normal files are still mapped");
    assert.ok(!names.has("leak.ts"), "files under .vscode-test are excluded");
    assert.ok(!names.has("huge.generated.ts"), "oversized files are skipped");
  } finally {
    await vscode.workspace.fs.delete(vscode.Uri.joinPath(root, ".vscode-test"), {
      recursive: true,
    });
    await vscode.workspace.fs.delete(oversized);
  }
});
