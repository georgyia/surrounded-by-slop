import { resolve } from "node:path";
import { runTests } from "@vscode/test-electron";

/**
 * Download a pinned VS Code, launch it with this extension loaded, and run the
 * suite inside that real host. Exits non-zero if the suite rejects.
 */
async function main(): Promise<void> {
  // A VS Code integrated terminal (and this repo's own extension dev host) sets
  // ELECTRON_RUN_AS_NODE=1. Inherited by the downloaded VS Code, it makes that
  // binary run as plain Node and reject its own CLI flags ("bad option: …").
  // Clear it so `pnpm test:integration` works from inside an editor too.
  delete process.env.ELECTRON_RUN_AS_NODE;

  // dist/test/ → packages/extension/
  const extensionDevelopmentPath = resolve(__dirname, "../..");
  const extensionTestsPath = resolve(__dirname, "./suite/index.js");
  // Open the small multi-file fixture so the workspace command has something to map.
  const workspaceFixture = resolve(__dirname, "../../test-fixtures/workspace");
  // CI also runs the suite against the oldest supported VS Code (SBS-092):
  // VSCODE_TEST_VERSION=1.96.0. Default is the current stable.
  const version = process.env.VSCODE_TEST_VERSION ?? "stable";
  await runTests({
    version,
    extensionDevelopmentPath,
    extensionTestsPath,
    // No settings sync, no other extensions — a clean, reproducible host.
    launchArgs: [workspaceFixture, "--disable-extensions"],
  });
}

main().catch((error) => {
  console.error("Integration tests failed:");
  console.error(error);
  process.exit(1);
});
