/**
 * Programmatic entry to the CLI — `run()` for embedding, plus the host layer so
 * other tools can reuse the discovery/analysis pipeline without shelling out.
 */
export { run } from "./cli.js";
export type { CommandContext } from "./context.js";
export {
  type AnalyzeProjectOptions,
  type AnalyzeProjectResult,
  analyzeProject,
} from "./host/analyze.js";
export {
  DEFAULT_EXCLUDE,
  DEFAULT_INCLUDE,
  type DiscoverOptions,
  discoverFiles,
} from "./host/discovery.js";
export { type AliasDiscovery, type AliasOptions, discoverAliasOptions } from "./host/tsconfig.js";
