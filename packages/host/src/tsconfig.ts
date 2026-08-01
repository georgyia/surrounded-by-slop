import * as path from "node:path";
import ts from "typescript";
import { workspacePackagePaths } from "./workspace-packages.js";

export interface AliasOptions {
  /** Where `paths` are anchored inside the core's virtual filesystem. */
  baseUrl: string;
  paths: Record<string, string[]>;
}

export function toVirtualAliasOptions(
  workspaceRoot: string,
  aliasBase: string,
  paths: Record<string, string[]>,
): AliasOptions | undefined {
  const relative = path.relative(workspaceRoot, aliasBase);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return undefined;
  }
  const segments = relative.split(path.sep).filter((segment) => segment.length > 0);
  return { baseUrl: `/${segments.join("/")}`, paths };
}

export interface AliasDiscovery {
  options: AliasOptions | undefined;
  /** Why there is nothing to pass. Undefined when aliases were discovered. */
  reason?: string;
}

/**
 * Find the nearest tsconfig and translate its aliases to the core's virtual
 * root, then add an alias per in-repo workspace package so cross-package
 * imports resolve to source instead of degrading to external nodes (#97).
 *
 * Both sets are re-anchored to the workspace root so there is a single base;
 * an explicit tsconfig alias always wins over a discovered package of the
 * same name.
 */
export function discoverAliasOptions(workspaceRoot: string): AliasDiscovery {
  const workspacePaths = workspacePackagePaths(workspaceRoot);
  const configPath = ts.findConfigFile(workspaceRoot, ts.sys.fileExists, "tsconfig.json");
  if (configPath === undefined) {
    return aliasesOrReason(workspacePaths, "no tsconfig.json found");
  }
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error !== undefined) {
    const message = ts.flattenDiagnosticMessageText(read.error.messageText, " ");
    return aliasesOrReason(workspacePaths, `${configPath} could not be read: ${message}`);
  }
  const parsed = ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    path.dirname(configPath),
    undefined,
    configPath,
  );
  const { paths, baseUrl, pathsBasePath } = parsed.options;
  if (paths === undefined) {
    return aliasesOrReason(workspacePaths, `${configPath} declares no path aliases`);
  }
  const aliasBase = baseUrl ?? (typeof pathsBasePath === "string" ? pathsBasePath : undefined);
  if (aliasBase === undefined) {
    return aliasesOrReason(workspacePaths, `${configPath} has paths but no resolvable base`);
  }
  const options = toVirtualAliasOptions(workspaceRoot, aliasBase, paths);
  if (options === undefined) {
    return aliasesOrReason(
      workspacePaths,
      `${configPath} anchors its aliases outside the workspace; ignoring them`,
    );
  }
  // Re-anchor the tsconfig's paths from its own base onto the workspace root so
  // the discovered package aliases, which are root-relative, can join them.
  const prefix = options.baseUrl === "/" ? "" : `${options.baseUrl.slice(1)}/`;
  const rebased: Record<string, string[]> = {};
  for (const [pattern, targets] of Object.entries(options.paths)) {
    rebased[pattern] = targets.map((target) => `${prefix}${target}`);
  }
  return { options: { baseUrl: "/", paths: { ...workspacePaths, ...rebased } } };
}

/** Workspace aliases alone still beat no aliases; keep the reason when empty. */
function aliasesOrReason(workspacePaths: Record<string, string[]>, reason: string): AliasDiscovery {
  if (Object.keys(workspacePaths).length === 0) {
    return { options: undefined, reason };
  }
  return { options: { baseUrl: "/", paths: workspacePaths } };
}
