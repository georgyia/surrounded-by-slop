import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverAliasOptions, toVirtualAliasOptions } from "./tsconfig.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sbs-tsconfig-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const write = (rel: string, text: string): void => {
  const full = join(root, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, text);
};

describe("discoverAliasOptions", () => {
  it("extracts path aliases anchored to the workspace", () => {
    write(
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } } }),
    );
    expect(discoverAliasOptions(root).options?.paths).toEqual({ "@/*": ["src/*"] });
  });

  it("reports why aliases cannot be discovered", () => {
    expect(discoverAliasOptions(root).reason).toContain("no tsconfig.json");
    write("tsconfig.json", JSON.stringify({ compilerOptions: { strict: true } }));
    expect(discoverAliasOptions(root).reason).toContain("no path aliases");
  });

  it("rejects alias bases outside the workspace", () => {
    expect(toVirtualAliasOptions(root, join(root, ".."), { "@/*": ["src/*"] })).toBeUndefined();
  });
});
