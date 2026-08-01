import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverAliasOptions } from "./tsconfig.js";
import { discoverWorkspacePackages, workspacePackagePaths } from "./workspace-packages.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sbs-workspace-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const write = (relative: string, text: string): void => {
  const full = join(root, relative);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, text);
};

const manifest = (name: string): string => JSON.stringify({ name });

describe("discoverWorkspacePackages", () => {
  it("finds packages by manifest, whatever the workspace layout", () => {
    write("package.json", JSON.stringify({ name: "the-repo", private: true }));
    write("packages/core/package.json", manifest("@scope/core"));
    write("packages/core/src/index.ts", "export const a = 1;\n");
    write("apps/web/package.json", manifest("web"));
    write("apps/web/src/main.ts", "export const b = 2;\n");

    expect(discoverWorkspacePackages(root)).toEqual([
      { name: "@scope/core", entry: "packages/core/src/index.ts", sourceRoot: "packages/core/src" },
      { name: "web", entry: "apps/web/src/main.ts", sourceRoot: "apps/web/src" },
    ]);
  });

  it("skips the root manifest, build output and vendored code", () => {
    write("package.json", manifest("the-repo"));
    write("index.ts", "export const root = 1;\n");
    write("node_modules/react/package.json", manifest("react"));
    write("node_modules/react/src/index.ts", "export const react = 1;\n");
    write("dist/bundled/package.json", manifest("bundled"));
    write("dist/bundled/src/index.ts", "export const bundled = 1;\n");

    expect(discoverWorkspacePackages(root)).toEqual([]);
  });

  it("ignores a package with no source entry to point at", () => {
    write("packages/types-only/package.json", manifest("@scope/types-only"));
    write("packages/types-only/README.md", "no sources here\n");

    expect(discoverWorkspacePackages(root)).toEqual([]);
  });

  it("emits a bare and a subpath alias per package", () => {
    write("packages/host/package.json", manifest("@scope/host"));
    write("packages/host/src/index.ts", "export const a = 1;\n");

    expect(workspacePackagePaths(root)).toEqual({
      "@scope/host": ["packages/host/src/index.ts"],
      "@scope/host/*": ["packages/host/src/*"],
    });
  });
});

describe("discoverAliasOptions with workspace packages", () => {
  it("supplies workspace aliases even when no tsconfig declares paths", () => {
    write("tsconfig.json", JSON.stringify({ compilerOptions: { strict: true } }));
    write("packages/core/package.json", manifest("@scope/core"));
    write("packages/core/src/index.ts", "export const a = 1;\n");

    expect(discoverAliasOptions(root).options).toEqual({
      baseUrl: "/",
      paths: {
        "@scope/core": ["packages/core/src/index.ts"],
        "@scope/core/*": ["packages/core/src/*"],
      },
    });
  });

  it("merges both sets, and an explicit tsconfig alias wins", () => {
    write(
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "@/*": ["src/*"], "@scope/core": ["vendored/core.ts"] },
        },
      }),
    );
    write("packages/core/package.json", manifest("@scope/core"));
    write("packages/core/src/index.ts", "export const a = 1;\n");

    expect(discoverAliasOptions(root).options?.paths).toEqual({
      "@/*": ["src/*"],
      "@scope/core": ["vendored/core.ts"],
      "@scope/core/*": ["packages/core/src/*"],
    });
  });

  it("still reports a reason when there is nothing to alias at all", () => {
    expect(discoverAliasOptions(root).reason).toContain("no tsconfig.json");
  });
});
