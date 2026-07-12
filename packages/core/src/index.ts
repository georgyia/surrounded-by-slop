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
export { cfgAtLine, extractControlFlow, reachableCfgBlocks } from "./cfg/builder.js";
export type {
  CfgBlock,
  CfgBlockKind,
  CfgEdge,
  CfgEdgeKind,
  ControlFlowGraph,
  ExtractedControlFlow,
} from "./cfg/types.js";
export { validateCfg } from "./cfg/validate.js";
export { drawioExporter } from "./export/drawio.js";
export {
  createExporterRegistry,
  type Exporter,
  type ExporterRegistry,
  type ExportOptions,
  requiredLayout,
} from "./export/exporter.js";
export { jsonExporter } from "./export/json.js";
export { mermaidExporter } from "./export/mermaid.js";
export { svgExporter } from "./export/svg.js";
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
export { displayLabel } from "./layout/label.js";
export {
  type GraphLayout,
  type LayoutEdge,
  type LayoutGraphOptions,
  type LayoutNode,
  type LayoutPoint,
  layoutGraph,
} from "./layout/layout.js";
export { stableStringify } from "./stable-json.js";
export {
  collapseToFolders,
  collapseToModules,
  expandableIds,
  expandNodes,
  type FilterOptions,
  filterGraph,
  reachableFrom,
  sliceAround,
} from "./transforms/transforms.js";
export { analyzeTypeScriptProject, typescriptAdapter } from "./typescript/adapter.js";
