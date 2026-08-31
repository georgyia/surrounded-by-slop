/**
 * The one place the CLI's version comes from (#146).
 *
 * `__SBS_VERSION__` is replaced by esbuild with the literal from
 * `package.json`, so nothing is read at runtime and the CLI and the MCP server
 * cannot disagree. The fallback keeps `vitest`, which runs the TypeScript
 * sources without the bundler, working — and is deliberately not a plausible
 * version number, so a build that lost its define is obvious rather than
 * quietly wrong.
 */
declare const __SBS_VERSION__: string | undefined;

export const VERSION: string = typeof __SBS_VERSION__ === "string" ? __SBS_VERSION__ : "0.0.0-dev";
