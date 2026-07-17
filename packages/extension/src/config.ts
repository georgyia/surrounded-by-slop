import * as vscode from "vscode";

/** The extension's settings, read fresh so changes apply on the next render (no reload). */
export interface SlopConfig {
  /** Globs for files to include when visualizing the workspace. */
  readonly include: readonly string[];
  /** Globs to exclude when visualizing the workspace. */
  readonly exclude: readonly string[];
  /** Include `*.test.*` / `*.spec.*` files in the workspace map. */
  readonly includeTests: boolean;
  /**
   * Show external packages / unresolved imports as nodes. `undefined` when the
   * user hasn't set it, so each view can pick its own default: the single-file
   * view shows them (what does this file depend on), the workspace map hides
   * them (external packages are fan-in hubs — noise on an architecture
   * overview). An explicit setting overrides both.
   */
  readonly showExternalModules: boolean | undefined;
  /** Diagram theme, or `auto` to follow the editor. */
  readonly theme: "auto" | "light" | "dark";
  /** Layout flow direction. */
  readonly layoutDirection: "RIGHT" | "DOWN";
}

const DEFAULT_INCLUDE = ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,py}"];
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

/**
 * The user's setting only if they actually set it (at any scope), else
 * `undefined` — so a per-view default can apply. `config.get` can't tell an
 * explicit `true` from the manifest's default `true`; `inspect` can.
 */
function explicitBoolean(config: vscode.WorkspaceConfiguration, key: string): boolean | undefined {
  const inspected = config.inspect<boolean>(key);
  return inspected?.workspaceFolderValue ?? inspected?.workspaceValue ?? inspected?.globalValue;
}

export function readConfig(): SlopConfig {
  const config = vscode.workspace.getConfiguration("slop");
  return {
    include: config.get<string[]>("include", DEFAULT_INCLUDE),
    exclude: config.get<string[]>("exclude", DEFAULT_EXCLUDE),
    includeTests: config.get<boolean>("includeTests", false),
    showExternalModules: explicitBoolean(config, "showExternalModules"),
    theme: config.get<"auto" | "light" | "dark">("theme", "auto"),
    layoutDirection:
      config.get<"right" | "down">("layoutDirection", "right") === "down" ? "DOWN" : "RIGHT",
  };
}
