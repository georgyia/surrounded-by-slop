/**
 * A pure unified-diff parser (SBS-114). Turns `git diff` text into the set of
 * new-file line numbers each file gained or had rewritten — the anchor for
 * mapping a change back to the symbols that enclose it. No git, no filesystem:
 * just text in, ranges out, so every edge case is a plain unit test.
 *
 * Renames and mode-only changes carry no hunks and therefore contribute nothing,
 * which is exactly right — a pure rename changes no behavior (empty impact).
 */

/** file (new path, forward-slashed) → changed new-file line numbers. */
export type ChangedLines = Map<string, Set<number>>;

const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/** Strip the `a/`|`b/` prefix, surrounding quotes, and a trailing tab timestamp. */
function cleanPath(raw: string): string {
  let path = raw.split("\t")[0] ?? raw;
  if (path.startsWith('"') && path.endsWith('"')) {
    path = path.slice(1, -1);
  }
  if (path.startsWith("a/") || path.startsWith("b/")) {
    path = path.slice(2);
  }
  return path;
}

export function parseUnifiedDiff(diff: string): ChangedLines {
  const changed: ChangedLines = new Map();
  const lines = diff.split("\n");

  let file: string | undefined;
  let newLine = 0;
  let inHunk = false;

  const record = (n: number): void => {
    if (file === undefined || file === "/dev/null") {
      return;
    }
    const set = changed.get(file) ?? new Set<number>();
    set.add(n);
    changed.set(file, set);
  };

  for (const line of lines) {
    if (line.startsWith("+++ ")) {
      file = cleanPath(line.slice(4));
      inHunk = false;
      continue;
    }
    if (line.startsWith("--- ")) {
      // Old-file header — ignored; the new path drives everything.
      continue;
    }
    if (line.startsWith("diff --git")) {
      file = undefined;
      inHunk = false;
      continue;
    }
    const hunk = HUNK.exec(line);
    if (hunk !== null) {
      newLine = Number.parseInt(hunk[1] ?? "0", 10);
      inHunk = true;
      continue;
    }
    if (!inHunk) {
      continue;
    }
    if (line.startsWith("+")) {
      record(newLine);
      newLine += 1;
    } else if (line.startsWith("-")) {
      // A deletion has no new line; attribute it to the line it sat before, so
      // the enclosing symbol at the deletion point is still caught.
      record(newLine);
    } else if (line.startsWith(" ") || line === "") {
      newLine += 1;
    } else {
      // "\ No newline at end of file" and similar metadata — leave the counter.
    }
  }

  return changed;
}
