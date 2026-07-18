import { runAll } from "../harness.js";
// Importing a test module registers its tests as a side effect.
import "./workspace.test.js";

/** Entry point for the multi-root host (see runTest.ts's second launch). */
export function run(): Promise<void> {
  return runAll();
}
