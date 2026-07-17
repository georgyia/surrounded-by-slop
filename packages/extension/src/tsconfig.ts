import * as path from "node:path";

/**
 * tsconfig discovery is a host concern by design: the core takes source text and
 * never touches the filesystem. What it does accept is
 * `adapterOptions.compilerOptions`, so a project's path aliases have to be found
 * here and handed over — otherwise every `@/foo` import resolves to nothing and
 * the map draws the project's own code as external packages (#68).
 */

export interface AliasOptions {
  /** Where `paths` are anchored inside the core's virtual filesystem (rooted at "/"). */
  baseUrl: string;
  paths: Record<string, string[]>;
}

/**
 * Rebase a project's alias base onto the virtual root the core analyzes under,
 * where every file id is workspace-relative. Pure: all filesystem work happened
 * before this. Returns undefined when the base sits outside the workspace, since
 * nothing there is in the program anyway.
 */
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
  /** Why there is nothing to pass, for the Output panel. Undefined when there is. */
  reason?: string;
}

/**
 * Find the nearest tsconfig for a workspace and extract its alias mapping.
 *
 * Deliberately uses the TypeScript API rather than JSON.parse: tsconfig allows
 * comments and trailing commas, and `extends` chains are routine — both of which
 * hand-rolled parsing gets wrong.
 */
export async function discoverAliasOptions(workspaceRoot: string): Promise<AliasDiscovery> {
  // Lazy: activation never pays for the TypeScript compiler.
  const ts = (await import("typescript")).default;
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
  // `paths` anchor to baseUrl when set, else to the config's own directory
  // (TypeScript reports that as pathsBasePath).
  const aliasBase = baseUrl ?? (typeof pathsBasePath === "string" ? pathsBasePath : undefined);
  if (aliasBase === undefined) {
    return { options: undefined, reason: `${configPath} has paths but no resolvable base` };
  }
  const options = toVirtualAliasOptions(workspaceRoot, aliasBase, paths);
  if (options === undefined) {
    return {
      options: undefined,
      reason: `${configPath} anchors its aliases outside the workspace; ignoring them`,
    };
  }
  return { options };
}
