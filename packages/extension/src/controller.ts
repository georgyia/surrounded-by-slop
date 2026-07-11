import type { DiagramData } from "@surrounded-by-slop/webview";
import * as vscode from "vscode";
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
      const { analyzeTypeScriptProject, layoutGraph } = await import("@surrounded-by-slop/core");
      // A broken file degrades to a partial graph plus diagnostics — surface those
      // as warnings and carry on rather than failing the whole visualization.
      const { graph, diagnostics } = analyzeTypeScriptProject([{ path, text: document.getText() }]);
      for (const diagnostic of diagnostics) {
        this.logger.warn(`${diagnostic.file ?? path}: ${diagnostic.message}`);
      }
      const layout = await layoutGraph(graph);
      const diagram: DiagramData = { title: path, graph, layout };
      this.shown = diagram;
      this.shownUri = document.uri;
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
