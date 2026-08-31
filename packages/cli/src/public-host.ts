import type { FileInput } from "@surrounded-by-slop/core";
import {
  DEFAULT_EXCLUDE as SHARED_DEFAULT_EXCLUDE,
  DEFAULT_INCLUDE as SHARED_DEFAULT_INCLUDE,
  MAX_FILE_BYTES as SHARED_MAX_FILE_BYTES,
  MAX_PROJECT_FILES as SHARED_MAX_PROJECT_FILES,
} from "@surrounded-by-slop/host/decisions";
import { discoverFiles as discoverSharedFiles } from "@surrounded-by-slop/host/discovery";
import { discoverAliasOptions as discoverSharedAliases } from "@surrounded-by-slop/host/tsconfig";

/** Why a file the globs matched was passed over anyway. */
export type SkipReason = "too-large" | "minified" | "file-limit";

/** Public host types are declared here so the private shared package never leaks into npm types. */
export interface DiscoverOptions {
  include?: readonly string[];
  exclude?: readonly string[];
  includeTests?: boolean;
  /** Skip files larger than this (default 512 KB). */
  maxFileBytes?: number;
  /** Stop after this many files (default 5,000). */
  maxFiles?: number;
  /** Called for every file the globs matched but the walk passed over. */
  onSkip?: (path: string, reason: SkipReason) => void;
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
export const MAX_FILE_BYTES: number = SHARED_MAX_FILE_BYTES;
export const MAX_PROJECT_FILES: number = SHARED_MAX_PROJECT_FILES;

export function discoverFiles(root: string, options: DiscoverOptions = {}): FileInput[] {
  return discoverSharedFiles(root, options);
}

export function discoverAliasOptions(workspaceRoot: string): AliasDiscovery {
  return discoverSharedAliases(workspaceRoot);
}
