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
export { cfgAtLine, extractControlFlow } from "./cfg/builder.js";
export {
  dataflowForSpan,
  type ExtractedDataflow,
  extractDataflow,
  type FunctionDataflow,
  type VariableFlow,
} from "./cfg/dataflow.js";
export { cfgToMermaid } from "./cfg/mermaid.js";
export { cfgBlockLabel, reachableCfgBlocks } from "./cfg/queries.js";
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
export { createIncrementalAnalyzer, type IncrementalAnalyzer } from "./incremental.js";
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
export {
  createPythonAdapter,
  type PythonWasm,
  pythonQueries,
  resolvePythonModule,
} from "./python/adapter.js";
export { stableStringify } from "./stable-json.js";
export { globToRegExp, matchesAnyGlob } from "./transforms/glob.js";
export {
  type RankedNode,
  type RankOptions,
  rankNodes,
} from "./transforms/rank.js";
export {
  collapseToFolders,
  collapseToModules,
  expandableIds,
  expandNodes,
  type FilterOptions,
  filterGraph,
  reachableFrom,
  reachedBy,
  shortestPath,
  sliceAround,
} from "./transforms/transforms.js";
export {
  analyzeWithTreeSitter,
  type LanguageQueries,
  type TreeSitterAnalysisOptions,
} from "./treesitter/mapper.js";
export { type LoadedLanguage, loadTreeSitterLanguage } from "./treesitter/runtime.js";
export { analyzeTypeScriptProject, typescriptAdapter } from "./typescript/adapter.js";
