import * as path from "node:path";
import ts from "typescript";

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

/** Find the nearest tsconfig and translate its aliases to the core's virtual root. */
export function discoverAliasOptions(workspaceRoot: string): AliasDiscovery {
  const configPath = ts.findConfigFile(workspaceRoot, ts.sys.fileExists, "tsconfig.json");
  if (configPath === undefined) {
    return { options: undefined, reason: "no tsconfig.json found" };
  }
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error !== undefined) {
    const message = ts.flattenDiagnosticMessageText(read.error.messageText, " ");
    return { options: undefined, reason: `${configPath} could not be read: ${message}` };
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
    return { options: undefined, reason: `${configPath} declares no path aliases` };
  }
  const aliasBase = baseUrl ?? (typeof pathsBasePath === "string" ? pathsBasePath : undefined);
  if (aliasBase === undefined) {
    return { options: undefined, reason: `${configPath} has paths but no resolvable base` };
  }
  const options = toVirtualAliasOptions(workspaceRoot, aliasBase, paths);
  return options === undefined
    ? {
        options: undefined,
        reason: `${configPath} anchors its aliases outside the workspace; ignoring them`,
      }
    : { options };
}
