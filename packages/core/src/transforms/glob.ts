/**
 * Minimal glob matching for path filters: `**` crosses directories, `*` stays
 * within a segment, `?` matches one character. Deliberately dependency-free
 * (Rule 3) — this is the entire feature set path filters need.
 */
export function globToRegExp(glob: string): RegExp {
  let pattern = "^";
  let index = 0;
  while (index < glob.length) {
    const char = glob[index];
    if (char === "*") {
      if (glob.startsWith("**/", index)) {
        pattern += "(?:.*/)?";
        index += 3;
        continue;
      }
      if (glob.startsWith("**", index)) {
        pattern += ".*";
        index += 2;
        continue;
      }
      pattern += "[^/]*";
      index += 1;
      continue;
    }
    if (char === "?") {
      pattern += "[^/]";
      index += 1;
      continue;
    }
    pattern += (char ?? "").replace(/[.+^${}()|[\]\\]/g, "\\$&");
    index += 1;
  }
  return new RegExp(`${pattern}$`);
}

export function matchesAnyGlob(path: string, globs: readonly string[]): boolean {
  return globs.some((glob) => globToRegExp(glob).test(path));
}
