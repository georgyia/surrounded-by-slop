import type { AnalysisResult } from "./ir/types.js";

/**
 * The plug-in seam for languages (docs/ir-spec.md). Adapters receive source
 * text — never filesystem access — and return a Semantic Graph. Capability
 * flags are honest: a structure-only adapter must say so instead of emitting
 * guessed call edges.
 */

export interface LanguageCapabilities {
  /** Whether the adapter produces `imports` edges. */
  imports: boolean;
  /** `"typed"` = resolver-backed, `"heuristic"` = best effort, `false` = none. */
  callGraph: "typed" | "heuristic" | false;
  /** Control-flow graphs (reserved for the X-Ray milestone). */
  cfg: boolean;
  /** Data-flow edges (reserved for the X-Ray milestone). */
  dataflow: boolean;
}

/** A source file handed to an adapter: root-relative path, forward slashes. */
export interface FileInput {
  path: string;
  text: string;
}

/** Cooperative cancellation; adapters check it at file/phase granularity. */
export interface CancellationToken {
  readonly cancelled: boolean;
}

export class OperationCancelledError extends Error {
  constructor() {
    super("analysis cancelled");
    this.name = "OperationCancelledError";
  }
}

export interface AnalysisProgress {
  phase: string;
  done: number;
  total: number;
}

export interface AnalysisOptions {
  /** Adapter-specific options, e.g. `{ compilerOptions: { paths: … } }` for TypeScript. */
  adapterOptions?: Record<string, unknown>;
  cancellation?: CancellationToken;
  onProgress?: (progress: AnalysisProgress) => void;
}

export interface LanguageAdapter {
  readonly id: string;
  readonly displayName: string;
  /** Lowercase extensions with the dot, e.g. `[".ts", ".tsx"]`. */
  readonly extensions: readonly string[];
  readonly capabilities: LanguageCapabilities;
  analyze(files: readonly FileInput[], options?: AnalysisOptions): AnalysisResult;
}

export interface AdapterRegistry {
  register(adapter: LanguageAdapter): void;
  byId(id: string): LanguageAdapter | undefined;
  forPath(path: string): LanguageAdapter | undefined;
  all(): readonly LanguageAdapter[];
}

export function createAdapterRegistry(): AdapterRegistry {
  const adapters = new Map<string, LanguageAdapter>();
  return {
    register(adapter) {
      if (adapters.has(adapter.id)) {
        throw new Error(`adapter ${adapter.id} is already registered`);
      }
      adapters.set(adapter.id, adapter);
    },
    byId(id) {
      return adapters.get(id);
    },
    forPath(path) {
      const dot = path.lastIndexOf(".");
      if (dot === -1) {
        return undefined;
      }
      const extension = path.slice(dot).toLowerCase();
      for (const adapter of adapters.values()) {
        if (adapter.extensions.includes(extension)) {
          return adapter;
        }
      }
      return undefined;
    },
    all() {
      return [...adapters.values()];
    },
  };
}
