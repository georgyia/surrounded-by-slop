import ts from "typescript";
import {
  type AnalysisOptions,
  type FileInput,
  type LanguageAdapter,
  OperationCancelledError,
} from "../adapter.js";
import { buildGraph } from "../ir/ids.js";
import type { AnalysisResult, Diagnostic } from "../ir/types.js";
import { collectFileCalls } from "./calls.js";
import { createProjectContext, type ProjectContext } from "./common.js";
import { createVirtualEnvironment, DEFAULT_COMPILER_OPTIONS } from "./host.js";
import { collectFileImports, markImportCycles } from "./imports.js";
import { collectFileStructure, resolveHeritage } from "./structure.js";

/**
 * Whole-project TypeScript/JavaScript analysis: one program, deterministic
 * file order, per-file phases with cancellation and progress. Input is source
 * text only — filesystem walking and tsconfig discovery are host concerns
 * (the extension layer), by design.
 */
export function analyzeTypeScriptProject(
  files: readonly FileInput[],
  options?: AnalysisOptions,
): AnalysisResult {
  const diagnostics: Diagnostic[] = [];
  const compilerOptions = compilerOptionsFrom(options?.adapterOptions, diagnostics);
  const { host, rootNames } = createVirtualEnvironment(files);
  const program = ts.createProgram({ rootNames, options: compilerOptions, host });
  const ctx = createProjectContext(program, host);
  ctx.diagnostics.push(...diagnostics);

  const sourceFiles = rootNames
    .map((name) => program.getSourceFile(name))
    .filter((file): file is ts.SourceFile => file !== undefined);

  runPhase(ctx, sourceFiles, options, "structure", collectFileStructure);
  resolveHeritage(ctx);
  runPhase(ctx, sourceFiles, options, "imports", collectFileImports);
  markImportCycles(ctx);
  runPhase(ctx, sourceFiles, options, "calls", collectFileCalls);

  const graph = buildGraph(ctx.nodes, ctx.edges);
  return { graph, diagnostics: ctx.diagnostics };
}

function runPhase(
  ctx: ProjectContext,
  sourceFiles: readonly ts.SourceFile[],
  options: AnalysisOptions | undefined,
  phase: string,
  visit: (ctx: ProjectContext, sourceFile: ts.SourceFile) => unknown,
): void {
  let done = 0;
  for (const sourceFile of sourceFiles) {
    if (options?.cancellation?.cancelled) {
      throw new OperationCancelledError();
    }
    visit(ctx, sourceFile);
    done += 1;
    options?.onProgress?.({ phase, done, total: sourceFiles.length });
  }
}

function compilerOptionsFrom(
  adapterOptions: Record<string, unknown> | undefined,
  diagnostics: Diagnostic[],
): ts.CompilerOptions {
  const raw = adapterOptions?.compilerOptions;
  if (raw === undefined) {
    return DEFAULT_COMPILER_OPTIONS;
  }
  const converted = ts.convertCompilerOptionsFromJson(raw, "/");
  for (const error of converted.errors) {
    diagnostics.push({
      severity: "warning",
      message: `compilerOptions: ${ts.flattenDiagnosticMessageText(error.messageText, " ")}`,
    });
  }
  // noLib and noEmit are structural to the in-memory analysis; they always win.
  return { ...DEFAULT_COMPILER_OPTIONS, ...converted.options, noLib: true, noEmit: true };
}

export const typescriptAdapter: LanguageAdapter = {
  id: "typescript",
  displayName: "TypeScript / JavaScript",
  extensions: [".ts", ".tsx", ".js", ".jsx"],
  // cfg: per-function control flow ships via `extractControlFlow` (SBS-070).
  capabilities: { imports: true, callGraph: "typed", cfg: true, dataflow: false },
  analyze: analyzeTypeScriptProject,
};
