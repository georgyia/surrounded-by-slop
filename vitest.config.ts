import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Only the pure packages run under Vitest. The extension package is
    // `vscode`-only glue: its tests live under `src/test/` and run in a real
    // Extension Development Host via @vscode/test-electron (`pnpm test:integration`).
    include: ["packages/core/src/**/*.test.ts", "packages/webview/src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      // The extension package is excluded on purpose: it only touches the
      // `vscode` API and is covered by integration tests in a real editor
      // host, not by unit coverage.
      include: ["packages/core/src/**/*.ts", "packages/webview/src/**/*.ts"],
      // `main.ts` is the browser bootstrap (DOM globals, `acquireVsCodeApi`):
      // like the extension host, it is exercised by integration tests in a real
      // webview, not by unit coverage. The renderer logic it calls stays pure
      // and is unit-tested here.
      exclude: ["**/*.test.ts", "packages/webview/src/main.ts"],
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
