/**
 * Deterministic JSON serialization.
 *
 * Everything this project emits — graphs, layouts, exports — must be
 * byte-identical for identical input, across runs and platforms, so that
 * generated artifacts are testable with golden files and diffable in Git.
 * `JSON.stringify` preserves object insertion order, which leaks traversal
 * order into the output; this serializer sorts object keys instead.
 */

/**
 * Serialize a value as JSON with all object keys sorted lexicographically.
 *
 * Matches `JSON.stringify` semantics: `toJSON` is honored, `undefined`,
 * functions and symbols are dropped from objects and become `null` in
 * arrays. Circular references throw a `TypeError`.
 */
export function stableStringify(value: unknown, space?: number): string {
  const seen = new Set<object>();
  const canonical = canonicalize(value, seen);
  return JSON.stringify(canonical, undefined, space);
}

function canonicalize(value: unknown, seen: Set<object>): unknown {
  if (hasToJson(value)) {
    return canonicalize(value.toJSON(), seen);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    throw new TypeError("stableStringify: converting circular structure to JSON");
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => canonicalize(item, seen));
    }
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const item = canonicalize((value as Record<string, unknown>)[key], seen);
      if (item !== undefined) {
        result[key] = item;
      }
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

function hasToJson(value: unknown): value is { toJSON(): unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    "toJSON" in value &&
    typeof (value as { toJSON: unknown }).toJSON === "function"
  );
}
