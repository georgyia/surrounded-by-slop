export {
  DEFAULT_EXCLUDE,
  DEFAULT_INCLUDE,
  expandBraces,
  isTestFile,
  looksMinified,
} from "./decisions.js";
export { type DiscoverOptions, discoverFiles } from "./discovery.js";
export { prefixPath, rootPrefixes, splitRootPath } from "./roots.js";
export {
  type AliasDiscovery,
  type AliasOptions,
  discoverAliasOptions,
  toVirtualAliasOptions,
} from "./tsconfig.js";
export {
  discoverWorkspacePackages,
  type WorkspacePackage,
  workspacePackagePaths,
} from "./workspace-packages.js";
