import { runAll } from "../harness.js";
// Importing a test module registers its tests as a side effect.
import "./activation.test.js";
import "./panel.test.js";
import "./visualize.test.js";

/** Entry point invoked by @vscode/test-electron inside the host. */
export function run(): Promise<void> {
  return runAll();
}
