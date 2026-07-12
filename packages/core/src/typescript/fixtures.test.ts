import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AnalysisOptions, FileInput } from "../adapter.js";
import { validateGraph } from "../ir/validate.js";
import { stableStringify } from "../stable-json.js";
import { analyzeTypeScriptProject } from "./adapter.js";

/**
 * Golden-fixture harness (see packages/core/fixtures/README.md).
 * Regenerate goldens with:  UPDATE_FIXTURES=1 pnpm test
 * Every case additionally passes the structural validator and a
 * double-run determinism check.
 */

const fixturesRoot = fileURLToPath(new URL("../../fixtures", import.meta.url));
const update = process.env.UPDATE_FIXTURES === "1";

interface FixtureCase {
  category: string;
  name: string;
  directory: string;
}

/** Categories with their own harness and golden format (src/cfg/fixtures.test.ts). */
const FOREIGN_CATEGORIES = new Set(["cfg"]);

function listCases(): FixtureCase[] {
  const cases: FixtureCase[] = [];
  for (const category of fs.readdirSync(fixturesRoot, { withFileTypes: true })) {
    if (!category.isDirectory() || FOREIGN_CATEGORIES.has(category.name)) {
      continue;
    }
    const categoryDir = path.join(fixturesRoot, category.name);
    for (const entry of fs.readdirSync(categoryDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        cases.push({
          category: category.name,
          name: entry.name,
          directory: path.join(categoryDir, entry.name),
        });
      }
    }
  }
  return cases.sort((a, b) => `${a.category}/${a.name}`.localeCompare(`${b.category}/${b.name}`));
}

function readInputs(directory: string): FileInput[] {
  const projectDir = path.join(directory, "project");
  if (fs.existsSync(projectDir)) {
    const files: FileInput[] = [];
    const walk = (current: string): void => {
      for (const entry of fs
        .readdirSync(current, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name))) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else {
          files.push({
            path: path.relative(projectDir, full).replaceAll(path.sep, "/"),
            text: fs.readFileSync(full, "utf8"),
          });
        }
      }
    };
    walk(projectDir);
    return files;
  }
  const single = fs
    .readdirSync(directory)
    .find((name) => name.startsWith("input.") && name !== "input.json");
  if (single === undefined) {
    throw new Error(`fixture ${directory} has neither project/ nor an input.* file`);
  }
  return [{ path: single, text: fs.readFileSync(path.join(directory, single), "utf8") }];
}

function readOptions(directory: string): AnalysisOptions | undefined {
  const optionsPath = path.join(directory, "options.json");
  if (!fs.existsSync(optionsPath)) {
    return undefined;
  }
  return { adapterOptions: JSON.parse(fs.readFileSync(optionsPath, "utf8")) };
}

const cases = listCases();

describe.each(cases)("fixture $category/$name", ({ directory }) => {
  it("matches its golden graph, validates and is deterministic", () => {
    const inputs = readInputs(directory);
    const options = readOptions(directory);
    const result = analyzeTypeScriptProject(inputs, options);

    expect(validateGraph(result.graph)).toEqual([]);

    const serialized = `${stableStringify(
      { diagnostics: result.diagnostics, graph: result.graph },
      2,
    )}\n`;
    const expectedPath = path.join(directory, "expected.json");
    if (update) {
      fs.writeFileSync(expectedPath, serialized);
    } else {
      expect(fs.existsSync(expectedPath), "expected.json missing — run UPDATE_FIXTURES=1").toBe(
        true,
      );
      expect(serialized).toBe(fs.readFileSync(expectedPath, "utf8"));
    }

    const secondRun = analyzeTypeScriptProject(inputs, options);
    expect(stableStringify({ diagnostics: secondRun.diagnostics, graph: secondRun.graph }, 2)).toBe(
      stableStringify({ diagnostics: result.diagnostics, graph: result.graph }, 2),
    );
  });
});

it("fixture suite is not empty", () => {
  expect(cases.length).toBeGreaterThan(0);
});
