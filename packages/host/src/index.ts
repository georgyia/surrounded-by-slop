export {
  DEFAULT_EXCLUDE,
  DEFAULT_INCLUDE,
  expandBraces,
  isTestFile,
  looksMinified,
} from "./decisions.js";
export { type DiscoverOptions, discoverFiles } from "./discovery.js";
export {
  type AliasDiscovery,
  type AliasOptions,
  discoverAliasOptions,
  toVirtualAliasOptions,
} from "./tsconfig.js";
