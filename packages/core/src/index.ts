export {
  type AdapterRegistry,
  type AnalysisOptions,
  type AnalysisProgress,
  type CancellationToken,
  createAdapterRegistry,
  type FileInput,
  type LanguageAdapter,
  type LanguageCapabilities,
  OperationCancelledError,
} from "./adapter.js";
export {
  buildGraph,
  canonicalizeGraph,
  declarationId,
  edgeId,
  externalModuleId,
  IdAllocator,
  moduleId,
  unresolvedFunctionId,
} from "./ir/ids.js";
export {
  type AnalysisResult,
  type Diagnostic,
  type EdgeKind,
  type GraphEdge,
  type GraphNode,
  type NodeKind,
  SCHEMA_VERSION,
  type SemanticGraph,
  type SourceSpan,
} from "./ir/types.js";
export { validateGraph } from "./ir/validate.js";
export { stableStringify } from "./stable-json.js";
