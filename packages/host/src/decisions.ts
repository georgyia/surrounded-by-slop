/** Shared, filesystem-free decisions about which source belongs in a project map. */

export const DEFAULT_INCLUDE = ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,py}"] as const;

export const DEFAULT_EXCLUDE = [
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
  "**/fixtures/**",
  "**/testdata/**",
] as const;

const TEST_DIRECTORY = /(^|\/)(__tests__|tests|spec)\//i;
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/i;
const PYTHON_TEST_FILE = /(^|\/)(test_[^/]+|[^/]+_test)\.py$/i;

/** Test conventions shared by the CLI, extension, scripts, and impact analysis. */
export function isTestFile(path: string): boolean {
  return TEST_DIRECTORY.test(path) || TEST_FILE.test(path) || PYTHON_TEST_FILE.test(path);
}

/** A bundled/minified artifact has an implausibly high average line length. */
export function looksMinified(text: string): boolean {
  if (text.length < 20_000) {
    return false;
  }
  let lines = 1;
  for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) {
    lines += 1;
  }
  return text.length / lines > 400;
}

/** Expand the single-level brace sets used by the repository's include globs. */
export function expandBraces(glob: string): string[] {
  const match = glob.match(/\{([^{}]*)\}/);
  if (match === null) {
    return [glob];
  }
  const [whole, body] = match;
  return (body ?? "").split(",").flatMap((option) => expandBraces(glob.replace(whole, option)));
}
