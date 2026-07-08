import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      // The extension package is excluded on purpose: it only touches the
      // `vscode` API and is covered by integration tests in a real editor
      // host, not by unit coverage.
      include: ["packages/core/src/**/*.ts", "packages/webview/src/**/*.ts"],
      exclude: ["**/*.test.ts"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
        "packages/core/src/**/*.ts": {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
        },
      },
    },
  },
});
