import type { SemanticGraph } from "@surrounded-by-slop/core";
import type { DiagramData } from "@surrounded-by-slop/webview";
import * as vscode from "vscode";
import { readConfig } from "./config.js";
import type { Logger } from "./log.js";
import type { DiagramView } from "./panel/diagramView.js";

/** VS Code language ids the TypeScript adapter understands, and their file suffix. */
const LANGUAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  typescript: ".ts",
  typescriptreact: ".tsx",
  javascript: ".js",
  javascriptreact: ".jsx",
};

const REFRESH_DEBOUNCE_MS = 300;
/** Guardrails so a stray huge tree (a downloaded SDK, a vendored bundle) can't run analysis away. */
const MAX_WORKSPACE_FILES = 5000;
const MAX_FILE_BYTES = 512 * 1024;
/**
 * Above this many modules the map stops being readable — fold up to the folder
 * level so a big repo opens as a handful of clusters rather than a hairball
 * (SBS-065). Drill back into modules by narrowing the scope.
 */
const MODULE_RENDER_BUDGET = 250;
/** Above this many nodes even the folded graph would choke the layout — bail with advice. */
const MAX_LAYOUT_NODES = 1500;

function suffixFor(document: vscode.TextDocument): string | undefined {
  return LANGUAGE_EXTENSIONS[document.languageId];
}

function exportTheme(): "light" | "dark" {
  const kind = vscode.window.activeColorTheme.kind;
  return kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast
    ? "dark"
    : "light";
}

/** Render the diagram in the format named by a file extension (drawio/svg/mmd/json). */
async function renderExport(format: string, diagram: DiagramData): Promise<string> {
  const { drawioExporter, jsonExporter, mermaidExporter, svgExporter } = await import(
    "@surrounded-by-slop/core"
  );
  switch (format) {
    case "drawio":
      return drawioExporter.export(diagram.graph, { layout: diagram.layout });
    case "svg":
      return svgExporter.export(diagram.graph, { layout: diagram.layout, theme: exportTheme() });
    case "mmd":
      return mermaidExporter.export(diagram.graph);
    case "json":
      return jsonExporter.export(diagram.graph);
    default:
      throw new Error(`unsupported export format ".${format}" — use .drawio, .mmd, .svg or .json`);
  }
}

/** Drop external (npm / unresolved) nodes and any edge that touched them. */
function withoutExternalModules(graph: SemanticGraph): SemanticGraph {
  const kept = new Set(graph.nodes.filter((node) => node.external !== true).map((node) => node.id));
  return {
    schemaVersion: graph.schemaVersion,
    nodes: graph.nodes.filter((node) => kept.has(node.id)),
    edges: graph.edges.filter((edge) => kept.has(edge.from) && kept.has(edge.to)),
  };
}

function isTestFile(path: string): boolean {
  return /\.(test|spec)\.[cm]?[jt]sx?$/i.test(path);
}

function braceGlob(globs: readonly string[]): string | undefined {
  // A single pattern is returned as-is: wrapping it in `{…}` would nest braces
  // (the default include already contains `{ts,tsx,…}`) and break the matcher.
  const [first] = globs;
  if (first === undefined) {
    return undefined;
  }
  return globs.length === 1 ? first : `{${globs.join(",")}}`;
}

/**
 * Drives visualization: the command, and the live behaviors around it — refresh
 * on save (debounced, viewport preserved by the view), Follow to track the
 * active editor, and Pin to freeze a diagram to its file.
 */
export class VisualizationController implements vscode.Disposable {
  private shown: DiagramData | undefined;
  private shownUri: vscode.Uri | undefined;
  private pinned = false;
  private following = false;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly disposables: vscode.Disposable[];

  constructor(
    private readonly view: DiagramView,
    private readonly logger: Logger,
  ) {
    this.disposables = [
      vscode.workspace.onDidSaveTextDocument((document) => this.onSave(document)),
      vscode.window.onDidChangeActiveTextEditor((editor) => this.onActiveEditor(editor)),
    ];
  }

  /** `Slop: Visualize File` — visualize the active editor. */
  async visualizeActive(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) {
      void vscode.window.showInformationMessage(
        "Surrounded by Slop: open a TypeScript or JavaScript file to visualize it.",
      );
      return;
    }
    if (suffixFor(editor.document) === undefined) {
      void vscode.window.showInformationMessage(
        `Surrounded by Slop can't visualize ${editor.document.languageId} yet — open a TS/JS file.`,
      );
      return;
    }
    await this.visualize(editor.document);
  }

  /** `Slop: Visualize Workspace` — the module-level map of every source file. */
  async visualizeWorkspace(token?: vscode.CancellationToken): Promise<void> {
    if (token !== undefined) {
      await this.runWorkspace(token);
      return;
    }
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Surrounded by Slop: analyzing workspace…",
        cancellable: true,
      },
      (_progress, progressToken) => this.runWorkspace(progressToken),
    );
  }

  private async runWorkspace(token: vscode.CancellationToken): Promise<void> {
    const [folder] = vscode.workspace.workspaceFolders ?? [];
    if (folder === undefined) {
      void vscode.window.showInformationMessage(
        "Surrounded by Slop: open a folder to visualize its workspace.",
      );
      return;
    }
    try {
      const config = readConfig();
      const uris = await vscode.workspace.findFiles(
        braceGlob(config.include) ?? "**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}",
        braceGlob(config.exclude),
        MAX_WORKSPACE_FILES,
        token,
      );
      if (token.isCancellationRequested) {
        return;
      }
      if (uris.length >= MAX_WORKSPACE_FILES) {
        this.logger.warn(
          `Workspace has more than ${MAX_WORKSPACE_FILES} files; mapping the first ${MAX_WORKSPACE_FILES}. Narrow it with slop.include / slop.exclude.`,
        );
      }
      const sourceUris = config.includeTests ? uris : uris.filter((uri) => !isTestFile(uri.path));
      const inputs: { path: string; text: string }[] = [];
      for (const uri of sourceUris) {
        if (token.isCancellationRequested) {
          return;
        }
        const relative = vscode.workspace.asRelativePath(uri, false);
        // Skip files too big to be hand-written — minified bundles and generated
        // blobs blow the analyzer's stack and aren't worth visualizing anyway.
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.size > MAX_FILE_BYTES) {
          this.logger.warn(`Skipped ${relative} (${Math.round(stat.size / 1024)} KB — too large).`);
          continue;
        }
        inputs.push({
          path: relative,
          text: new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)),
        });
      }
      if (inputs.length === 0) {
        void vscode.window.showInformationMessage(
          "Surrounded by Slop: no TypeScript or JavaScript files found here.",
        );
        return;
      }

      const { analyzeTypeScriptProject, collapseToFolders, collapseToModules, layoutGraph } =
        await import("@surrounded-by-slop/core");
      // Bridge VS Code's token (isCancellationRequested) to the core's (cancelled).
      const cancellation = {
        get cancelled(): boolean {
          return token.isCancellationRequested;
        },
      };
      const analyzed = analyzeTypeScriptProject(inputs, { cancellation });
      for (const diagnostic of analyzed.diagnostics) {
        this.logger.warn(`${diagnostic.file ?? "workspace"}: ${diagnostic.message}`);
      }
      if (token.isCancellationRequested) {
        return;
      }
      // The map opens collapsed to modules — never thousands of nodes by default.
      const base = config.showExternalModules
        ? analyzed.graph
        : withoutExternalModules(analyzed.graph);
      const modules = collapseToModules(base);
      // Guardrail (SBS-065): past the readability budget, fold modules up to the
      // folder level so a large repo shows as clusters, not a hairball.
      let collapsed = modules;
      let level: "modules" | "folders" = "modules";
      if (modules.nodes.length > MODULE_RENDER_BUDGET) {
        const folders = collapseToFolders(base, 1);
        if (folders.nodes.length < modules.nodes.length) {
          collapsed = folders;
          level = "folders";
        }
      }
      if (collapsed.nodes.length > MAX_LAYOUT_NODES) {
        void vscode.window.showInformationMessage(
          `Surrounded by Slop: this workspace is too large to map at once (${collapsed.nodes.length} groups). Narrow it with slop.include / slop.exclude, or open a subfolder.`,
        );
        this.logger.warn(
          `Workspace map skipped: ${collapsed.nodes.length} groups exceeds the ${MAX_LAYOUT_NODES}-node guardrail.`,
        );
        return;
      }
      const layout = await layoutGraph(collapsed, { direction: config.layoutDirection });
      if (token.isCancellationRequested) {
        return;
      }
      const diagram: DiagramData = {
        title:
          level === "folders"
            ? `${folder.name} — workspace (folders)`
            : `${folder.name} — workspace`,
        graph: collapsed,
        layout,
      };
      this.shown = diagram;
      this.shownUri = undefined;
      void vscode.commands.executeCommand("setContext", "slop.hasDiagram", true);
      this.view.show(diagram);
      this.logger.info(
        `Visualized workspace ${folder.name}: ${inputs.length} files → ${collapsed.nodes.length} ${level}`,
      );
      if (level === "folders") {
        // Tell the user why they're seeing folders, and offer the way back in.
        void vscode.window
          .showInformationMessage(
            `Surrounded by Slop: ${modules.nodes.length} modules is a lot — showing a folder-level overview. Narrow the scope to see individual modules.`,
            "Configure scope",
          )
          .then((choice) => {
            if (choice === "Configure scope") {
              void vscode.commands.executeCommand(
                "workbench.action.openSettings",
                "surrounded-by-slop",
              );
            }
          });
      }
    } catch (error) {
      if (error instanceof Error && error.name === "OperationCancelledError") {
        return;
      }
      this.logger.report("Surrounded by Slop couldn't visualize the workspace.", error);
    }
  }

  /** `Slop: Pin Diagram` — stop (or resume) refreshing on save and following. */
  togglePin(): void {
    this.pinned = !this.pinned;
    void vscode.window.showInformationMessage(
      this.pinned
        ? "Diagram pinned — it won't change."
        : "Diagram unpinned — it refreshes on save.",
    );
  }

  /** `Slop: Follow Active Editor` — re-visualize whenever the active editor changes. */
  toggleFollow(): void {
    this.following = !this.following;
    void vscode.window.showInformationMessage(
      this.following ? "Following the active editor." : "No longer following the active editor.",
    );
    if (this.following) {
      void this.visualizeActive();
    }
  }

  /** `Slop: Export Diagram As…` — pick a file, write the current diagram in that format. */
  async exportInteractive(): Promise<void> {
    if (this.shown === undefined) {
      void vscode.window.showInformationMessage(
        "Surrounded by Slop: visualize a file first, then export it.",
      );
      return;
    }
    const defaultUri = this.defaultExportUri(this.shown.title);
    const target = await vscode.window.showSaveDialog({
      title: "Export Diagram",
      filters: { "draw.io": ["drawio"], Mermaid: ["mmd"], SVG: ["svg"], JSON: ["json"] },
      ...(defaultUri !== undefined ? { defaultUri } : {}),
    });
    if (target !== undefined) {
      await this.exportTo(target);
    }
  }

  /** Write the current diagram to `target`, choosing the format from its extension. */
  async exportTo(target: vscode.Uri): Promise<void> {
    const diagram = this.shown;
    if (diagram === undefined) {
      void vscode.window.showInformationMessage(
        "Surrounded by Slop: visualize a file first, then export it.",
      );
      return;
    }
    const format = target.path.slice(target.path.lastIndexOf(".") + 1).toLowerCase();
    try {
      const content = await renderExport(format, diagram);
      await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(content));
      const name = target.path.split("/").pop() ?? "diagram";
      // Fire-and-forget: the file is already written; don't block on the toast.
      void vscode.window.showInformationMessage(`Exported ${name}.`, "Open").then((choice) => {
        if (choice === "Open") {
          void vscode.commands.executeCommand("vscode.open", target);
        }
      });
    } catch (error) {
      this.logger.report("Surrounded by Slop couldn't export the diagram.", error);
    }
  }

  /** `Slop: Copy Diagram as Mermaid` — put the current diagram on the clipboard. */
  async copyMermaid(): Promise<void> {
    const diagram = this.shown;
    if (diagram === undefined) {
      void vscode.window.showInformationMessage(
        "Surrounded by Slop: visualize a file first, then copy it.",
      );
      return;
    }
    const { mermaidExporter } = await import("@surrounded-by-slop/core");
    await vscode.env.clipboard.writeText(mermaidExporter.export(diagram.graph));
    void vscode.window.showInformationMessage("Diagram copied as Mermaid.");
  }

  private defaultExportUri(title: string): vscode.Uri | undefined {
    const base =
      title
        .replace(/\.[^.]+$/, "")
        .split("/")
        .pop() ?? "diagram";
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
    return folder === undefined ? undefined : vscode.Uri.joinPath(folder, `${base}.drawio`);
  }

  private async visualize(document: vscode.TextDocument): Promise<void> {
    const suffix = suffixFor(document);
    if (suffix === undefined) {
      return;
    }
    const path = document.isUntitled
      ? `untitled${suffix}`
      : vscode.workspace.asRelativePath(document.uri);
    try {
      const config = readConfig();
      const { analyzeTypeScriptProject, layoutGraph } = await import("@surrounded-by-slop/core");
      // A broken file degrades to a partial graph plus diagnostics — surface those
      // as warnings and carry on rather than failing the whole visualization.
      const analyzed = analyzeTypeScriptProject([{ path, text: document.getText() }]);
      for (const diagnostic of analyzed.diagnostics) {
        this.logger.warn(`${diagnostic.file ?? path}: ${diagnostic.message}`);
      }
      const graph = config.showExternalModules
        ? analyzed.graph
        : withoutExternalModules(analyzed.graph);
      const layout = await layoutGraph(graph, { direction: config.layoutDirection });
      const diagram: DiagramData = { title: path, graph, layout };
      this.shown = diagram;
      this.shownUri = document.uri;
      // Reveal the diagram-dependent commands (export, copy, pin) in the palette.
      void vscode.commands.executeCommand("setContext", "slop.hasDiagram", true);
      this.view.show(diagram, document.uri);
      this.logger.info(
        `Visualized ${path}: ${graph.nodes.length} nodes, ${graph.edges.length} edges`,
      );
    } catch (error) {
      this.logger.report(`Surrounded by Slop couldn't visualize ${path}.`, error);
    }
  }

  private onSave(document: vscode.TextDocument): void {
    if (this.pinned || this.shownUri === undefined) {
      return;
    }
    if (document.uri.toString() !== this.shownUri.toString()) {
      return;
    }
    if (this.refreshTimer !== undefined) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.visualize(document);
    }, REFRESH_DEBOUNCE_MS);
  }

  private onActiveEditor(editor: vscode.TextEditor | undefined): void {
    if (this.pinned || !this.following || editor === undefined) {
      return;
    }
    if (suffixFor(editor.document) === undefined) {
      return;
    }
    if (editor.document.uri.toString() === this.shownUri?.toString()) {
      return;
    }
    void this.visualize(editor.document);
  }

  dispose(): void {
    if (this.refreshTimer !== undefined) {
      clearTimeout(this.refreshTimer);
    }
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
  }
}
