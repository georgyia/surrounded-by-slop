/**
 * The multi-root id scheme (#74).
 *
 * Module ids are root-relative paths, so two roots that each contain
 * `src/index.ts` would mint the same id and silently merge two unrelated
 * modules into one box. The fix has to make ids unambiguous across roots
 * *without* changing the single-root ids that every fixture, golden file and
 * stored diagram already encodes.
 *
 * So: a single root keeps bare paths (`src/index.ts`), and only a genuine
 * multi-root workspace prefixes each path with its root's name
 * (`web/src/index.ts`). That is VS Code's own convention for showing paths in
 * a multi-root workspace, so the diagram reads the way the explorer does, and
 * the folder-overview collapse gets a useful top level for free: one box per
 * root.
 *
 * Root names are not guaranteed unique — two folders from different parents
 * can both be called `app` — so duplicates take a stable `~n` suffix by their
 * order in the workspace, which is part of the `.code-workspace` file and
 * therefore deterministic for a given workspace definition.
 */

/** Separator between a root prefix and the path inside that root. */
const SEPARATOR = "/";

/**
 * A prefix per root, positionally matching `names`.
 *
 * One root yields `[""]` — no prefix at all, so single-root paths are
 * byte-identical to what they have always been.
 */
export function rootPrefixes(names: readonly string[]): string[] {
  if (names.length <= 1) {
    return names.map(() => "");
  }
  const counts = new Map<string, number>();
  for (const name of names) {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  return names.map((name) => {
    if ((counts.get(name) ?? 0) === 1) {
      return name;
    }
    const nth = (seen.get(name) ?? 0) + 1;
    seen.set(name, nth);
    return `${name}~${nth}`;
  });
}

/** Join a root prefix and a path inside that root into a graph path. */
export function prefixPath(prefix: string, relative: string): string {
  return prefix === "" ? relative : `${prefix}${SEPARATOR}${relative}`;
}

/**
 * The inverse of {@link prefixPath}: which root a graph path belongs to, and
 * where inside it. Returns `undefined` when no root claims the path — a
 * diagram restored from a different workspace, say — so callers can fall back
 * rather than open the wrong file.
 */
export function splitRootPath(
  prefixes: readonly string[],
  path: string,
): { rootIndex: number; relative: string } | undefined {
  const single = prefixes.length === 1 && prefixes[0] === "";
  if (single) {
    return { rootIndex: 0, relative: path };
  }
  for (const [rootIndex, prefix] of prefixes.entries()) {
    if (prefix === "") {
      continue;
    }
    const head = `${prefix}${SEPARATOR}`;
    if (path.startsWith(head)) {
      return { rootIndex, relative: path.slice(head.length) };
    }
  }
  return undefined;
}
