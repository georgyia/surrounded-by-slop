import ts from "typescript";
import type { FileInput } from "../adapter.js";

/**
 * A fully in-memory compiler environment. The core never touches the
 * filesystem (Rule 5): files come in as text, live under a virtual `/` root,
 * and the analysis is byte-identical on every platform. `noLib` is deliberate
 * — built-in symbols stay unresolved, which the call-graph rules account for
 * (docs/ir-spec.md, "Call-graph precision").
 */

// Every extension `slop.include` collects, minus `.py` (a different adapter).
// Leaving one out drops those files from the program silently: they simply
// never appear on the map, with no diagnostic to explain the hole.
const ANALYZABLE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
] as const;

export function isAnalyzablePath(path: string): boolean {
  const lower = path.toLowerCase();
  return ANALYZABLE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/** Forward slashes, no leading `./` — the canonical root-relative form. */
export function normalizeRelativePath(path: string): string {
  let normalized = path.replaceAll("\\", "/");
  while (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }
  return normalized;
}

export function toVirtualPath(relativePath: string): string {
  return `/${relativePath}`;
}

export function toRelativePath(virtualPath: string): string {
  return virtualPath.startsWith("/") ? virtualPath.slice(1) : virtualPath;
}

export const DEFAULT_COMPILER_OPTIONS: ts.CompilerOptions = {
  noLib: true,
  allowJs: true,
  checkJs: false,
  jsx: ts.JsxEmit.Preserve,
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  types: [],
  noEmit: true,
  skipLibCheck: true,
};

function scriptKindFor(path: string): ts.ScriptKind {
  const lower = path.toLowerCase();
  if (lower.endsWith(".tsx")) {
    return ts.ScriptKind.TSX;
  }
  if (lower.endsWith(".jsx")) {
    return ts.ScriptKind.JSX;
  }
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) {
    return ts.ScriptKind.JS;
  }
  // .ts, .mts, .cts.
  return ts.ScriptKind.TS;
}

export interface VirtualEnvironment {
  host: ts.CompilerHost;
  /** Virtual paths of analyzable files, sorted for deterministic program order. */
  rootNames: string[];
}

export function createVirtualEnvironment(files: readonly FileInput[]): VirtualEnvironment {
  const fileMap = new Map<string, string>();
  for (const file of files) {
    fileMap.set(toVirtualPath(normalizeRelativePath(file.path)), file.text);
  }
  const directories = new Set<string>();
  for (const virtualPath of fileMap.keys()) {
    let directory = virtualPath;
    while (directory.includes("/") && directory !== "/") {
      directory = directory.slice(0, directory.lastIndexOf("/")) || "/";
      directories.add(directory);
    }
  }

  const sourceCache = new Map<string, ts.SourceFile>();
  const host: ts.CompilerHost = {
    fileExists: (path) => fileMap.has(path),
    readFile: (path) => fileMap.get(path),
    directoryExists: (path) => directories.has(path),
    getDirectories: () => [],
    getSourceFile(fileName, languageVersion) {
      const cached = sourceCache.get(fileName);
      if (cached) {
        return cached;
      }
      const text = fileMap.get(fileName);
      if (text === undefined) {
        return undefined;
      }
      const sourceFile = ts.createSourceFile(
        fileName,
        text,
        languageVersion,
        true,
        scriptKindFor(fileName),
      );
      sourceCache.set(fileName, sourceFile);
      return sourceFile;
    },
    getDefaultLibFileName: () => "/lib.d.ts",
    writeFile: () => {},
    getCurrentDirectory: () => "/",
    getCanonicalFileName: (fileName) => fileName,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
  };

  const rootNames = [...fileMap.keys()].filter(isAnalyzablePath).sort();
  return { host, rootNames };
}
