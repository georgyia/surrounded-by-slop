import type { SemanticGraph } from "@surrounded-by-slop/core";
import type { DiagramData } from "@surrounded-by-slop/webview";
import * as vscode from "vscode";
import { readConfig } from "./config.js";
import type { Logger } from "./log.js";
import type { DiagramView } from "./panel/diagramView.js";
import { discoverAliasOptions } from "./tsconfig.js";

/** VS Code language ids the analyzers understand, and their file suffix. */
const LANGUAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  typescript: ".ts",
  typescriptreact: ".tsx",
  javascript: ".js",
  javascriptreact: ".jsx",
  python: ".py",
};

/**
 * The Python adapter loads its tree-sitter grammar on first use (SBS-081);
 * the wasm binaries sit next to the host bundle (see esbuild.mjs).
 */
let pythonAdapterPromise: Promise<import("@surrounded-by-slop/core").LanguageAdapter> | undefined;
function pythonAdapter(): Promise<import("@surrounded-by-slop/core").LanguageAdapter> {
  if (pythonAdapterPromise === undefined) {
    pythonAdapterPromise = (async () => {
      const { readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const { createPythonAdapter } = await import("@surrounded-by-slop/core");
      return createPythonAdapter({
        runtime: new Uint8Array(await readFile(join(__dirname, "web-tree-sitter.wasm"))),
        python: new Uint8Array(await readFile(join(__dirname, "tree-sitter-python.wasm"))),
      });
    })();
  }
  return pythonAdapterPromise;
}

/** Merge per-language analyses into one workspace graph (ids never collide). */
async function mergeResults(
  results: readonly import("@surrounded-by-slop/core").AnalysisResult[],
): Promise<import("@surrounded-by-slop/core").AnalysisResult> {
  const [first, ...rest] = results;
  if (first === undefined) {
    return { graph: { schemaVersion: 1, nodes: [], edges: [] }, diagnostics: [] };
  }
  if (rest.length === 0) {
    return first;
  }
  const { canonicalizeGraph } = await import("@surrounded-by-slop/core");
  return {
    graph: canonicalizeGraph({
      schemaVersion: first.graph.schemaVersion,
      nodes: results.flatMap((result) => result.graph.nodes),
      edges: results.flatMap((result) => result.graph.edges),
    }),
    diagnostics: results.flatMap((result) => result.diagnostics),
  };
}

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
/**
 * Density guardrail (SBS-090 benchmarks): layout cost is driven by edges, not
 * nodes — ~200 modules sharing hub utilities already means >1,000 edges and a
 * multi-second layout. Fold to folders past this many non-containment edges
 * even when the module count looks harmless.
 */
const EDGE_RENDER_BUDGET = 600;
/** Above this many nodes even the folded graph would choke the layout — bail with advice. */
const MAX_LAYOUT_NODES = 1500;

function flatEdgeCount(graph: SemanticGraph): number {
  return graph.edges.filter((edge) => edge.kind !== "contains").length;
}
/** How many hops of neighbors an "isolate" keeps around the chosen node (SBS-063). */
const ISOLATE_DEPTH = 1;

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
  const {
    cfgToMermaid,
    drawioExporter,
    jsonExporter,
    mermaidExporter,
    stableStringify,
    svgExporter,
  } = await import("@surrounded-by-slop/core");
  switch (format) {
    case "drawio":
      // Flow charts export their synthetic block graph — positions and block
      // text are faithful; the condition labels live in the mmd/json formats.
      return drawioExporter.export(diagram.graph, { layout: diagram.layout });
    case "svg":
      return svgExporter.export(diagram.graph, { layout: diagram.layout, theme: exportTheme() });
    case "mmd":
      return diagram.flow === undefined
        ? mermaidExporter.export(diagram.graph)
        : cfgToMermaid(diagram.flow);
    case "json":
      return diagram.flow === undefined
        ? jsonExporter.export(diagram.graph)
        : `${stableStringify(diagram.flow, 2)}\n`;
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

/**
 * Drop unresolved-call sink nodes (every `Promise(...)`, `Math.max(...)`, …
 * lands on one). Informative in a single-file view; on a workspace map they
 * are parentless orphans that blanket the fold as hundreds of tiny chips.
 */
function withoutUnresolvedSinks(graph: SemanticGraph): SemanticGraph {
  const kept = new Set(
    graph.nodes
      .filter((node) => !(node.external === true && node.kind !== "module"))
      .map((node) => node.id),
  );
  return {
    schemaVersion: graph.schemaVersion,
    nodes: graph.nodes.filter((node) => kept.has(node.id)),
    edges: graph.edges.filter((edge) => kept.has(edge.from) && kept.has(edge.to)),
  };
}

/**
 * Minified bundles under the byte cap still poison a map with alphabet-soup
 * identifiers; the classic signature is very long lines. Cheap and safe: a
 * hand-written file never averages hundreds of chars per line.
 */
function looksMinified(text: string): boolean {
  if (text.length < 20_000) {
    return false;
  }
  let lines = 1;
  for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) {
    lines += 1;
  }
  return text.length / lines > 400;
}

function isTestFile(path: string): boolean {
  return (
    /(^|\/)(__tests__|tests|spec)\//i.test(path) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/i.test(path) ||
    /(^|\/)(test_[^/]+|[^/]+_test)\.py$/i.test(path)
  );
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
  /** The full workspace graph behind an expandable module map, and which
   * containers the user has opened (SBS-062). Undefined for a file view or a
   * folder-level overview, where expansion doesn't apply. */
  private workspaceGraph: SemanticGraph | undefined;
  private workspaceTitle = "";
  private readonly expanded = new Set<string>();
  /** The diagram shown before an isolate, so "Show all" can restore it (SBS-063). */
  private preIsolate: DiagramData | undefined;
  private readonly disposables: vscode.Disposable[];

  constructor(
    private readonly view: DiagramView,
    private readonly logger: Logger,
  ) {
    this.disposables = [
      vscode.workspace.onDidSaveTextDocument((document) => this.onSave(document)),
      vscode.window.onDidChangeActiveTextEditor((editor) => this.onActiveEditor(editor)),
      this.view.onToggleExpand((nodeId) => this.onToggleExpand(nodeId)),
      this.view.onIsolate((nodeId) => void this.isolate(nodeId)),
      this.view.onResetView(() => this.resetIsolate()),
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

  /**
   * `Slop: Visualize Function Flow` — the control-flow chart of the function
   * under the cursor (SBS-071). Layout runs on a synthetic one-node-per-block
   * graph; the webview draws the real CFG edges, kinds and condition labels.
   */
  async visualizeFunctionFlow(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (
      editor === undefined ||
      suffixFor(editor.document) === undefined ||
      editor.document.languageId === "python" // CFG extraction is TS/JS-only so far
    ) {
      void vscode.window.showInformationMessage(
        "Surrounded by Slop: open a TypeScript or JavaScript file and put the cursor inside a function.",
      );
      return;
    }
    const document = editor.document;
    const path = document.isUntitled
      ? `untitled${suffixFor(document) ?? ".ts"}`
      : vscode.workspace.asRelativePath(document.uri);
    try {
      const {
        buildGraph,
        cfgAtLine,
        cfgBlockLabel,
        dataflowForSpan,
        edgeId,
        extractControlFlow,
        extractDataflow,
        layoutGraph,
      } = await import("@surrounded-by-slop/core");
      const { cfgs, diagnostics } = extractControlFlow({ path, text: document.getText() });
      for (const diagnostic of diagnostics) {
        this.logger.warn(`${diagnostic.file ?? path}: ${diagnostic.message}`);
      }
      const line = editor.selection.active.line + 1; // vscode is 0-based, spans are 1-based
      const cfg = cfgAtLine(cfgs, line);
      if (cfg === undefined) {
        void vscode.window.showInformationMessage(
          "Surrounded by Slop: put the cursor inside a function body to see its flow.",
        );
        return;
      }
      // Synthetic layout graph: one plain-labeled node per block. Entry/exit
      // carry the function's own span so clicking Start/End jumps to its head.
      const nodes = cfg.blocks.map((block) => ({
        id: block.id,
        kind: "variable" as const,
        name: cfgBlockLabel(block),
        qualifiedName: block.id,
        span: block.spans[0] ?? cfg.span,
        // Full statement list rides along for the hover card.
        ...(block.statements.length > 0 ? { signature: block.statements.join("\n") } : {}),
      }));
      const seen = new Set<string>();
      const edges = [];
      for (const edge of cfg.edges) {
        const id = edgeId("calls", edge.from, edge.to);
        if (!seen.has(id) && edge.from !== edge.to) {
          seen.add(id);
          edges.push({ id, kind: "calls" as const, from: edge.from, to: edge.to });
        }
      }
      const graph = buildGraph(nodes, edges);
      // Flowcharts read top-down regardless of the diagram direction setting.
      const layout = await layoutGraph(graph, { direction: "DOWN" });
      // Def-use overlay (SBS-072): aligned to this function by its span.
      const dataflow = dataflowForSpan(
        extractDataflow({ path, text: document.getText() }).functions,
        cfg.span,
      );
      const diagram: DiagramData = {
        title: `${cfg.name} — flow`,
        graph,
        layout,
        flow: cfg,
        ...(dataflow !== undefined ? { dataflow } : {}),
      };
      this.workspaceGraph = undefined;
      this.expanded.clear();
      this.preIsolate = undefined;
      this.shown = diagram;
      // No live-refresh for flow charts (the function may move on edit); reveal
      // resolves through the workspace-relative span paths instead.
      this.shownUri = undefined;
      void vscode.commands.executeCommand("setContext", "slop.hasDiagram", true);
      this.view.show(diagram, document.isUntitled ? document.uri : undefined);
      this.logger.info(
        `Visualized flow of ${cfg.name} (${path}): ${cfg.blocks.length} blocks, ${cfg.edges.length} edges`,
      );
    } catch (error) {
      this.logger.report(`Surrounded by Slop couldn't chart the function flow in ${path}.`, error);
    }
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
    const folders = vscode.workspace.workspaceFolders ?? [];
    const [folder] = folders;
    if (folder === undefined) {
      void vscode.window.showInformationMessage(
        "Surrounded by Slop: open a folder to visualize its workspace.",
      );
      return;
    }
    // Multi-root: module ids are root-relative paths, so two roots can both
    // contain src/index.ts and collide — an id scheme for that is still open
    // (#74). Until then map the first root only, and say so out loud instead
    // of silently mixing roots into one confidently-wrong graph.
    if (folders.length > 1) {
      const skipped = folders.slice(1).map((other) => other.name);
      this.logger.warn(
        `Multi-root workspace: mapping only "${folder.name}". Not mapped: ${skipped.join(", ")}. ` +
          "Multi-root support is tracked at https://github.com/georgyia/surrounded-by-slop/issues/74.",
      );
      void vscode.window.showWarningMessage(
        `Surrounded by Slop: multi-root workspaces aren't supported yet — mapping only "${folder.name}" (${skipped.length} other root${skipped.length === 1 ? "" : "s"} left off the map).`,
      );
    }
    try {
      const config = readConfig();
      const uris = await vscode.workspace.findFiles(
        new vscode.RelativePattern(
          folder,
          braceGlob(config.include) ?? "**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,py}",
        ),
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
        const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
        if (looksMinified(text)) {
          this.logger.warn(`Skipped ${relative} (looks minified/generated — not worth mapping).`);
          continue;
        }
        inputs.push({ path: relative, text });
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
      // Each language analyzes with its own adapter; the maps merge afterwards
      // (module ids are path-based, so they can never collide).
      const pythonInputs = inputs.filter((input) => input.path.endsWith(".py"));
      const tsInputs = inputs.filter((input) => !input.path.endsWith(".py"));
      const results = [];
      if (tsInputs.length > 0) {
        // Without the project's own aliases, every `@/foo` import resolves to
        // nothing and the map draws the project's own code as external
        // packages — the map is then confidently wrong rather than empty (#68).
        const aliases = await discoverAliasOptions(folder.uri.fsPath);
        if (aliases.options === undefined) {
          this.logger.info(`Path aliases: ${aliases.reason ?? "none"}.`);
        } else {
          const count = Object.keys(aliases.options.paths).length;
          this.logger.info(
            `Path aliases: resolving ${count} pattern(s) against ${aliases.options.baseUrl}.`,
          );
        }
        results.push(
          analyzeTypeScriptProject(tsInputs, {
            cancellation,
            ...(aliases.options === undefined
              ? {}
              : { adapterOptions: { compilerOptions: aliases.options } }),
          }),
        );
      }
      if (pythonInputs.length > 0) {
        results.push((await pythonAdapter()).analyze(pythonInputs, { cancellation }));
      }
      const analyzed = await mergeResults(results);
      for (const diagnostic of analyzed.diagnostics) {
        this.logger.warn(`${diagnostic.file ?? "workspace"}: ${diagnostic.message}`);
      }
      if (token.isCancellationRequested) {
        return;
      }
      // The map opens collapsed to modules — never thousands of nodes by
      // default — and unresolved sinks never belong on a workspace map.
      // Workspace overview hides external packages unless the user opted in:
      // react/next/etc. are fan-in hubs that turn the map into a hairball (on
      // this repo, ~70% of edges and the densest nodes were external).
      const base = withoutUnresolvedSinks(
        (config.showExternalModules ?? false)
          ? analyzed.graph
          : withoutExternalModules(analyzed.graph),
      );
      const modules = collapseToModules(base);
      this.preIsolate = undefined; // a fresh workspace map is not an isolate
      // Guardrail (SBS-065 + SBS-090): past the readability budget — by module
      // count or by edge density — fold up to the folder level so a large repo
      // shows as clusters, not a hairball. In that overview expansion is off —
      // narrow the scope to get an expandable map.
      if (
        modules.nodes.length > MODULE_RENDER_BUDGET ||
        flatEdgeCount(modules) > EDGE_RENDER_BUDGET
      ) {
        // A src-rooted repo folds to a single useless box at depth 1 — deepen
        // until the overview has enough groups to be a map.
        let folders = collapseToFolders(base, 1);
        if (folders.nodes.filter((node) => node.kind === "folder").length < 4) {
          folders = collapseToFolders(base, 2);
        }
        const overview = folders.nodes.length < modules.nodes.length ? folders : modules;
        if (overview.nodes.length > MAX_LAYOUT_NODES) {
          void vscode.window.showInformationMessage(
            `Surrounded by Slop: this workspace is too large to map at once (${overview.nodes.length} groups). Narrow it with slop.include / slop.exclude, or open a subfolder.`,
          );
          this.logger.warn(
            `Workspace map skipped: ${overview.nodes.length} groups exceeds the ${MAX_LAYOUT_NODES}-node guardrail.`,
          );
          return;
        }
        const layout = await layoutGraph(overview, { direction: config.layoutDirection });
        if (token.isCancellationRequested) {
          return;
        }
        this.workspaceGraph = undefined;
        this.expanded.clear();
        const diagram: DiagramData = {
          title: `${folder.name} — workspace (folders)`,
          graph: overview,
          layout,
        };
        this.shown = diagram;
        this.shownUri = undefined;
        void vscode.commands.executeCommand("setContext", "slop.hasDiagram", true);
        this.view.show(diagram);
        this.logger.info(
          `Visualized workspace ${folder.name}: ${inputs.length} files → ${overview.nodes.length} groups`,
        );
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
        return;
      }

      // Small enough to be an expandable module map: keep the full graph and
      // open every module collapsed; double-clicking one reveals its members.
      this.workspaceGraph = base;
      this.workspaceTitle = `${folder.name} — workspace`;
      this.expanded.clear();
      this.shownUri = undefined;
      await this.renderWorkspaceExpansion(true, token);
      this.logger.info(
        `Visualized workspace ${folder.name}: ${inputs.length} files → ${modules.nodes.length} modules`,
      );
    } catch (error) {
      if (error instanceof Error && error.name === "OperationCancelledError") {
        return;
      }
      this.logger.report("Surrounded by Slop couldn't visualize the workspace.", error);
    }
  }

  /** Re-render the workspace map for the current expansion, keeping the viewport
   * unless `fit` (the first render) is requested. */
  private async renderWorkspaceExpansion(
    fit: boolean,
    token?: vscode.CancellationToken,
  ): Promise<void> {
    const base = this.workspaceGraph;
    if (base === undefined) {
      return;
    }
    const config = readConfig();
    const { expandNodes, expandableIds, layoutGraph } = await import("@surrounded-by-slop/core");
    const display = expandNodes(base, this.expanded);
    const ids = expandableIds(base, display, this.expanded);
    const layout = await layoutGraph(display, { direction: config.layoutDirection });
    if (token?.isCancellationRequested) {
      return;
    }
    const diagram: DiagramData = {
      title: this.workspaceTitle,
      graph: display,
      layout,
      expandableIds: ids,
    };
    this.shown = diagram;
    void vscode.commands.executeCommand("setContext", "slop.hasDiagram", true);
    if (fit) {
      this.view.show(diagram);
    } else {
      this.view.update(diagram);
    }
  }

  /** `Isolate`: show only a node's neighborhood, sliced from the current view. */
  /** Also reachable from the diagram's native context menu. */
  async isolate(nodeId: string): Promise<void> {
    const base = this.preIsolate ?? this.shown;
    if (base === undefined) {
      return;
    }
    try {
      const config = readConfig();
      const { sliceAround, layoutGraph } = await import("@surrounded-by-slop/core");
      const sliced = sliceAround(base.graph, nodeId, ISOLATE_DEPTH);
      const layout = await layoutGraph(sliced, { direction: config.layoutDirection });
      this.preIsolate ??= base; // remember the full view to restore later
      const diagram: DiagramData = {
        title: `${base.title} — isolated`,
        graph: sliced,
        layout,
        isolated: true,
      };
      this.shown = diagram;
      this.view.show(diagram);
    } catch (error) {
      this.logger.report("Surrounded by Slop couldn't isolate that node.", error);
    }
  }

  /** `Show all`: drop the isolate and restore the diagram it sliced from. */
  private resetIsolate(): void {
    const base = this.preIsolate;
    if (base === undefined) {
      return;
    }
    this.preIsolate = undefined;
    this.shown = base;
    this.view.show(base);
  }

  /** Click on a container: toggle its expansion and re-render in place. */
  private onToggleExpand(nodeId: string): void {
    if (this.workspaceGraph === undefined) {
      return;
    }
    if (this.expanded.has(nodeId)) {
      this.expanded.delete(nodeId);
    } else {
      this.expanded.add(nodeId);
    }
    void this.renderWorkspaceExpansion(false);
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
    const { cfgToMermaid, mermaidExporter } = await import("@surrounded-by-slop/core");
    const mermaid =
      diagram.flow === undefined
        ? mermaidExporter.export(diagram.graph)
        : cfgToMermaid(diagram.flow);
    await vscode.env.clipboard.writeText(mermaid);
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
      const analyzed =
        document.languageId === "python"
          ? (await pythonAdapter()).analyze([{ path, text: document.getText() }])
          : analyzeTypeScriptProject([{ path, text: document.getText() }]);
      for (const diagnostic of analyzed.diagnostics) {
        this.logger.warn(`${diagnostic.file ?? path}: ${diagnostic.message}`);
      }
      // Single file: external deps are the point ("what does this import"), so
      // show them unless the user turned them off.
      const graph =
        (config.showExternalModules ?? true)
          ? analyzed.graph
          : withoutExternalModules(analyzed.graph);
      const layout = await layoutGraph(graph, { direction: config.layoutDirection });
      const diagram: DiagramData = { title: path, graph, layout };
      // A file view is fully expanded already — leave expansion/isolate mode.
      this.workspaceGraph = undefined;
      this.expanded.clear();
      this.preIsolate = undefined;
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
