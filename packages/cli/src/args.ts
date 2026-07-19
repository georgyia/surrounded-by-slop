/**
 * A tiny argument parser (Rule 3: a CLI framework is not justifiable for a
 * handful of subcommands). Supports `--flag`, `--key value`, `--key=value`, and
 * repeatable options; everything that is not a flag is a positional. Unknown
 * flags are surfaced so a typo fails loudly rather than being ignored.
 */

export interface ParsedArgs {
  positionals: string[];
  /** Boolean flags that were present. */
  flags: Set<string>;
  /** Options with values; repeatable options collect every occurrence. */
  options: Map<string, string[]>;
}

/** Flags that never take a value, so `--json map` treats `map` as a positional. */
export interface ArgSpec {
  booleans: readonly string[];
}

export function parseArgs(argv: readonly string[], spec: ArgSpec): ParsedArgs {
  const booleans = new Set(spec.booleans);
  const positionals: string[] = [];
  const flags = new Set<string>();
  const options = new Map<string, string[]>();

  const addOption = (key: string, value: string): void => {
    const existing = options.get(key) ?? [];
    existing.push(value);
    options.set(key, existing);
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) {
      continue;
    }
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const body = arg.slice(2);
    const eq = body.indexOf("=");
    if (eq !== -1) {
      addOption(body.slice(0, eq), body.slice(eq + 1));
      continue;
    }
    if (booleans.has(body)) {
      flags.add(body);
      continue;
    }
    // `--key value`: consume the next argument as the value.
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      // A value-less non-boolean flag is treated as a present boolean, so
      // callers can still detect it; validation is the command's job.
      flags.add(body);
      continue;
    }
    addOption(body, next);
    i += 1;
  }

  return { positionals, flags, options };
}

/** First value of a repeatable option, if any. */
export function optionValue(parsed: ParsedArgs, key: string): string | undefined {
  return parsed.options.get(key)?.[0];
}

/** All values of a repeatable option (e.g. multiple `--include`). */
export function optionValues(parsed: ParsedArgs, key: string): string[] {
  return parsed.options.get(key) ?? [];
}

/** An integer option, or `fallback` when absent; throws on a non-integer. */
export function intOption(parsed: ParsedArgs, key: string, fallback: number): number {
  const raw = optionValue(parsed, key);
  if (raw === undefined) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || String(value) !== raw.trim()) {
    throw new UsageError(`--${key} expects an integer, got "${raw}"`);
  }
  return value;
}

/** A user-facing error: printed as a one-line message, exit code 2, no stack. */
export class UsageError extends Error {}
