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

/**
 * Drives visualization: the command, and the live behaviors around it — refresh
 * on save (debounced, viewport preserved by the view), Follow to track the
 * active editor, and Pin to freeze a diagram to its file.
 */
export class VisualizationController implements vscode.Disposable {
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
      this.shownUri = document.uri;
      this.view.show({ title: path, graph, layout }, document.uri);
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
