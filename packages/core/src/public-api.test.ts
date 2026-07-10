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
    "createAdapterRegistry",
    "declarationId",
    "edgeId",
    "externalModuleId",
    "moduleId",
    "stableStringify",
    "typescriptAdapter",
    "unresolvedFunctionId",
    "validateGraph",
  ]);
  expect(core.SCHEMA_VERSION).toBe(1);
});
