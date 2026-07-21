import type { FileInput } from "@surrounded-by-slop/core";
import {
  DEFAULT_EXCLUDE as SHARED_DEFAULT_EXCLUDE,
  DEFAULT_INCLUDE as SHARED_DEFAULT_INCLUDE,
} from "@surrounded-by-slop/host/decisions";
import { discoverFiles as discoverSharedFiles } from "@surrounded-by-slop/host/discovery";
import { discoverAliasOptions as discoverSharedAliases } from "@surrounded-by-slop/host/tsconfig";

/** Public host types are declared here so the private shared package never leaks into npm types. */
export interface DiscoverOptions {
  include?: readonly string[];
  exclude?: readonly string[];
  includeTests?: boolean;
}

export interface AliasOptions {
  baseUrl: string;
  paths: Record<string, string[]>;
}

export interface AliasDiscovery {
  options: AliasOptions | undefined;
  reason?: string;
}

export const DEFAULT_INCLUDE: readonly string[] = SHARED_DEFAULT_INCLUDE;
export const DEFAULT_EXCLUDE: readonly string[] = SHARED_DEFAULT_EXCLUDE;

export function discoverFiles(root: string, options: DiscoverOptions = {}): FileInput[] {
  return discoverSharedFiles(root, options);
}

export function discoverAliasOptions(workspaceRoot: string): AliasDiscovery {
  return discoverSharedAliases(workspaceRoot);
}
