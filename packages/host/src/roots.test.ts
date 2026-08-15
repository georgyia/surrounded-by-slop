import { describe, expect, it } from "vitest";
import { prefixPath, rootPrefixes, splitRootPath } from "./roots.js";

describe("rootPrefixes", () => {
  it("gives a single root no prefix, so existing ids never move", () => {
    expect(rootPrefixes(["web"])).toEqual([""]);
    expect(rootPrefixes([])).toEqual([]);
  });

  it("names each root when there is more than one", () => {
    expect(rootPrefixes(["web", "api"])).toEqual(["web", "api"]);
  });

  it("disambiguates duplicate root names by workspace order", () => {
    expect(rootPrefixes(["app", "lib", "app"])).toEqual(["app~1", "lib", "app~2"]);
  });

  it("is deterministic for the same workspace definition", () => {
    const names = ["app", "app", "web"];
    expect(rootPrefixes(names)).toEqual(rootPrefixes(names));
  });
});

describe("prefixPath", () => {
  it("leaves a single-root path exactly as it was", () => {
    expect(prefixPath("", "src/index.ts")).toBe("src/index.ts");
  });

  it("prefixes with the root name in a multi-root workspace", () => {
    expect(prefixPath("web", "src/index.ts")).toBe("web/src/index.ts");
  });
});

describe("splitRootPath", () => {
  it("round-trips every path it prefixed", () => {
    const prefixes = rootPrefixes(["web", "api", "api"]);
    for (const [rootIndex, prefix] of prefixes.entries()) {
      const path = prefixPath(prefix, "src/index.ts");
      expect(splitRootPath(prefixes, path)).toEqual({ rootIndex, relative: "src/index.ts" });
    }
  });

  it("keeps two roots' identically-named modules apart", () => {
    const prefixes = rootPrefixes(["web", "api"]);
    const web = prefixPath(prefixes[0] ?? "", "src/index.ts");
    const api = prefixPath(prefixes[1] ?? "", "src/index.ts");
    expect(web).not.toBe(api);
    expect(splitRootPath(prefixes, web)?.rootIndex).toBe(0);
    expect(splitRootPath(prefixes, api)?.rootIndex).toBe(1);
  });

  it("treats every path as the sole root's when there is one root", () => {
    expect(splitRootPath([""], "src/index.ts")).toEqual({ rootIndex: 0, relative: "src/index.ts" });
  });

  it("returns nothing when no root claims the path", () => {
    // A diagram restored from a different workspace: better to fall back than
    // to open a confidently wrong file.
    expect(splitRootPath(["web", "api"], "other/src/index.ts")).toBeUndefined();
  });

  it("does not mistake a prefix for a longer root name", () => {
    const prefixes = rootPrefixes(["web", "web-admin"]);
    expect(splitRootPath(prefixes, "web-admin/src/a.ts")).toEqual({
      rootIndex: 1,
      relative: "src/a.ts",
    });
  });
});
