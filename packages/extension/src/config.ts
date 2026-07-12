import * as vscode from "vscode";

/** The extension's settings, read fresh so changes apply on the next render (no reload). */
export interface SlopConfig {
  /** Globs for files to include when visualizing the workspace. */
  readonly include: readonly string[];
  /** Globs to exclude when visualizing the workspace. */
  readonly exclude: readonly string[];
  /** Include `*.test.*` / `*.spec.*` files in the workspace map. */
  readonly includeTests: boolean;
  /** Show external packages / unresolved imports as nodes. */
  readonly showExternalModules: boolean;
  /** Diagram theme, or `auto` to follow the editor. */
  readonly theme: "auto" | "light" | "dark";
  /** Layout flow direction. */
  readonly layoutDirection: "RIGHT" | "DOWN";
}

const DEFAULT_INCLUDE = ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"];
const DEFAULT_EXCLUDE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/out/**",
  "**/build/**",
  "**/coverage/**",
  "**/.git/**",
  "**/.vscode-test/**",
  "**/.next/**",
  "**/.nuxt/**",
  "**/.svelte-kit/**",
  "**/.turbo/**",
  "**/.cache/**",
  "**/vendor/**",
  "**/*.min.js",
];

export function readConfig(): SlopConfig {
  const config = vscode.workspace.getConfiguration("slop");
  return {
    include: config.get<string[]>("include", DEFAULT_INCLUDE),
    exclude: config.get<string[]>("exclude", DEFAULT_EXCLUDE),
    includeTests: config.get<boolean>("includeTests", false),
    showExternalModules: config.get<boolean>("showExternalModules", true),
    theme: config.get<"auto" | "light" | "dark">("theme", "auto"),
    layoutDirection:
      config.get<"right" | "down">("layoutDirection", "right") === "down" ? "DOWN" : "RIGHT",
  };
}
