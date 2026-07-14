import { expect, it } from "vitest";
import * as core from "./index.js";

/**
 * Locks the public surface of @surrounded-by-slop/core. A failure here means
 * a breaking API change — deliberate ones update this list and add a changeset.
 */
it("exports exactly the documented public api", () => {
  expect(Object.keys(core).sort()).toEqual([
    "IdAllocator",
    "OperationCancelledError",
    "SCHEMA_VERSION",
    "analyzeTypeScriptProject",
    "buildGraph",
    "canonicalizeGraph",
    "cfgAtLine",
    "cfgBlockLabel",
    "cfgToMermaid",
    "collapseToFolders",
    "collapseToModules",
    "createAdapterRegistry",
    "createExporterRegistry",
    "createIncrementalAnalyzer",
    "dataflowForSpan",
    "declarationId",
    "displayLabel",
    "drawioExporter",
    "edgeId",
    "expandNodes",
    "expandableIds",
    "externalModuleId",
    "extractControlFlow",
    "extractDataflow",
    "filterGraph",
    "jsonExporter",
    "layoutGraph",
    "mermaidExporter",
    "moduleId",
    "reachableCfgBlocks",
    "reachableFrom",
    "requiredLayout",
    "sliceAround",
    "stableStringify",
    "svgExporter",
    "typescriptAdapter",
    "unresolvedFunctionId",
    "validateCfg",
    "validateGraph",
  ]);
  expect(core.SCHEMA_VERSION).toBe(1);
});
