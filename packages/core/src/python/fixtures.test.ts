import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { FileInput, LanguageAdapter } from "../adapter.js";
import { validateGraph } from "../ir/validate.js";
import { stableStringify } from "../stable-json.js";
import { createPythonAdapter } from "./adapter.js";

/**
 * Golden-fixture harness for the Python adapter (`fixtures/python/*`), same
 * rules as every other harness: regenerate with UPDATE_FIXTURES=1 pnpm test.
 * Grammar wasm comes from node_modules — tests may touch the filesystem,
 * the adapter itself never does.
 */

const fixturesRoot = fileURLToPath(new URL("../../fixtures/python", import.meta.url));
const update = process.env.UPDATE_FIXTURES === "1";
const require = createRequire(import.meta.url);

let adapter: LanguageAdapter;
beforeAll(async () => {
  adapter = await createPythonAdapter({
    runtime: fs.readFileSync(require.resolve("web-tree-sitter/web-tree-sitter.wasm")),
    python: fs.readFileSync(
      path.join(
        path.dirname(require.resolve("@vscode/tree-sitter-wasm/package.json")),
        "wasm/tree-sitter-python.wasm",
      ),
    ),
  });
});

function listCases(): { name: string; directory: string }[] {
  if (!fs.existsSync(fixturesRoot)) {
    return [];
  }
  return fs
    .readdirSync(fixturesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, directory: path.join(fixturesRoot, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
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
  const single = fs.readdirSync(directory).find((name) => name.startsWith("input."));
  if (single === undefined) {
    throw new Error(`python fixture ${directory} has neither project/ nor input.*`);
  }
  return [{ path: single, text: fs.readFileSync(path.join(directory, single), "utf8") }];
}

const cases = listCases();

describe.each(cases)("python fixture $name", ({ directory }) => {
  it("matches its golden graph, validates and is deterministic", () => {
    const inputs = readInputs(directory);
    const result = adapter.analyze(inputs);
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

    const second = adapter.analyze(inputs);
    expect(stableStringify({ diagnostics: second.diagnostics, graph: second.graph }, 2)).toBe(
      stableStringify({ diagnostics: result.diagnostics, graph: result.graph }, 2),
    );
  });
});

it("the python fixture suite covers at least 15 shapes", () => {
  expect(cases.length).toBeGreaterThanOrEqual(15);
});

it("the adapter declares honest capabilities", () => {
  expect(adapter.capabilities).toEqual({
    imports: true,
    callGraph: "heuristic",
    cfg: false,
    dataflow: false,
  });
  expect(adapter.extensions).toEqual([".py"]);
});
