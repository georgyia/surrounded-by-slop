import { matchesAnyGlob } from "@surrounded-by-slop/core";
import { describe, expect, it } from "vitest";
import { DEFAULT_EXCLUDE, expandBraces, isTestFile, looksMinified } from "./decisions.js";

describe("isTestFile", () => {
  it.each([
    "src/app.test.ts",
    "src/app.spec.tsx",
    "test_app.py",
    "src/app_test.py",
    "__tests__/helper.ts",
    "src/tests/helper.ts",
    "Spec/helper.ts",
  ])("classifies %s as test code", (path) => {
    expect(isTestFile(path)).toBe(true);
  });

  it.each([
    "src/contests/helper.ts",
    "src/mytests/helper.ts",
    "src/tests-integration/helper.ts",
    "src/attestations/helper.ts",
    "src/specs/helper.ts",
  ])("does not over-match %s", (path) => {
    expect(isTestFile(path)).toBe(false);
  });
});

describe("looksMinified", () => {
  it("ignores small one-line source and rejects large one-line bundles", () => {
    expect(looksMinified("export const value = 1;")).toBe(false);
    expect(looksMinified(`const value=1;${"/*pad*/".repeat(4_000)}`)).toBe(true);
  });
});

describe("expandBraces", () => {
  it("expands the source-extension include pattern", () => {
    expect(expandBraces("**/*.{ts,tsx,py}")).toEqual(["**/*.ts", "**/*.tsx", "**/*.py"]);
  });
});

describe("DEFAULT_EXCLUDE covers every supported language's build output (#142)", () => {
  const matches = (path: string): boolean =>
    DEFAULT_EXCLUDE.some((glob) => matchesAnyGlob(path, [glob]));

  it("skips the build and dependency directories of each language", () => {
    const generated = [
      "target/debug/deps/dep.rs", // Rust (cargo)
      "target/classes/Gen.java", // Java (Maven)
      "obj/Debug/AssemblyInfo.cs", // C# (MSBuild)
      ".gradle/caches/thing.java", // Java (Gradle)
      ".venv/lib/python3.12/site-packages/requests/mod.py", // Python
      "venv/lib/python3.12/site-packages/x.py",
      "src/__pycache__/app.cpython-312.py",
      "lib/site-packages/dep.py",
      ".tox/py312/lib/x.py",
      ".mypy_cache/3.12/app.py",
      ".pytest_cache/v/cache/x.py",
      "vendor/bundle/ruby/3.3.0/gems/rails/lib/rails.rb",
      ".bundle/config.rb",
      "node_modules/pkg/index.js",
    ];
    for (const path of generated) {
      expect(matches(path), `${path} should be skipped`).toBe(true);
    }
  });

  it("still analyzes the source directories those conventions collide with", () => {
    // `packages/` is NuGet's convention *and* this repo's source root, and the
    // root of most JS monorepos — excluding it would blank out the projects
    // this tool is dogfooded on. `bin/` is a C# build directory but also where
    // plenty of JS and Python projects keep real entry points; `obj/` is the
    // one that actually holds generated C#.
    for (const path of [
      "packages/core/src/index.ts",
      "packages/cli/src/bin.ts",
      "bin/cli.js",
      "bin/tool.py",
      "src/target.ts", // a *file* called target, not a directory
      "src/venv_helper.py",
    ]) {
      expect(matches(path), `${path} should be analyzed`).toBe(false);
    }
  });
});
