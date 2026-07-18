import * as assert from "node:assert";
import type { DiagramData } from "@surrounded-by-slop/webview";
import * as vscode from "vscode";
import type { SlopApi } from "../../extension.js";
import type { LogRecord } from "../../log.js";
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

// The interim contract for #74: until an id scheme keeps two roots'
// identically-named modules apart, the map covers the first root only —
// loudly, never silently.
test("a multi-root workspace maps only the first root, and says so", async () => {
  const api = await getApi();
  const folders = vscode.workspace.workspaceFolders ?? [];
  assert.strictEqual(folders.length, 2, "the host opened the two-root .code-workspace");

  const logs: LogRecord[] = [];
  const logSubscription = api.onDidLog((record) => logs.push(record));
  try {
    const visualized = nextVisualize(api);
    await api.visualizeWorkspace(new vscode.CancellationTokenSource().token);
    const diagram = await withTimeout(visualized, 20_000, "multi-root workspace visualize");

    const names = new Set(diagram.graph.nodes.map((node) => node.name));
    assert.ok(names.has("alpha.ts"), `the first root is mapped (got ${[...names].join(", ")})`);
    assert.ok(!names.has("zeta.ts"), "the second root is not silently mixed onto the map");

    const warning = logs.find(
      (record) => record.level === "warn" && record.message.includes("Multi-root workspace"),
    );
    assert.ok(warning, "the skipped roots are called out in the output channel");
    assert.ok(warning.message.includes("workspace-b"), "the warning names the unmapped root");
    assert.ok(warning.message.includes("issues/74"), "the warning links the tracking issue");
  } finally {
    logSubscription.dispose();
  }
});
