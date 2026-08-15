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

async function mapWorkspace(api: SlopApi): Promise<DiagramData> {
  const visualized = nextVisualize(api);
  await api.visualizeWorkspace(new vscode.CancellationTokenSource().token);
  return withTimeout(visualized, 20_000, "multi-root workspace visualize");
}

test("a multi-root workspace maps every root (#74)", async () => {
  const api = await getApi();
  const folders = vscode.workspace.workspaceFolders ?? [];
  assert.strictEqual(folders.length, 2, "the host opened the two-root .code-workspace");

  const diagram = await mapWorkspace(api);
  const ids = new Set(diagram.graph.nodes.map((node) => node.id));

  // Both roots are on the map, each under its own name.
  assert.ok(ids.has("module:workspace/alpha.ts"), `first root mapped (got ${[...ids].join(", ")})`);
  assert.ok(ids.has("module:workspace-b/zeta.ts"), "second root mapped");
});

test("identically-named modules in two roots stay separate nodes (#74)", async () => {
  const api = await getApi();
  const diagram = await mapWorkspace(api);
  const ids = diagram.graph.nodes.map((node) => node.id);

  // Both roots contain alpha.ts. Before the root prefix they minted the same
  // id and silently merged into one box.
  assert.ok(ids.includes("module:workspace/alpha.ts"), "the first root's alpha.ts");
  assert.ok(ids.includes("module:workspace-b/alpha.ts"), "the second root's alpha.ts");
  assert.strictEqual(new Set(ids).size, ids.length, "no duplicate ids on the merged map");
});

test("a node from the second root reveals the file in that root (#74)", async () => {
  const api = await getApi();
  await mapWorkspace(api);

  // The workspace map opens collapsed to modules, so a module node is what a
  // user actually has to click.
  await api.revealNode("module:workspace-b/zeta.ts");
  const editor = vscode.window.activeTextEditor;
  assert.ok(editor, "an editor opened");
  assert.ok(
    editor.document.uri.path.endsWith("workspace-b/zeta.ts"),
    `the second root's file opened, not the first root's (got ${editor.document.uri.path})`,
  );
});

test("each root's own path aliases are used, not the first root's (#74)", async () => {
  const api = await getApi();
  const diagram = await mapWorkspace(api);

  // The first root has a tsconfig with `@/*` aliases; the second has none.
  // Analyzing per root means the second root's files are not resolved through
  // the first root's baseUrl, which would draw them as external packages.
  const externalFromB = diagram.graph.nodes.filter(
    (node) => node.external === true && node.qualifiedName.includes("workspace-b"),
  );
  assert.deepStrictEqual(externalFromB, [], "no file of the second root is mapped as external");
});
