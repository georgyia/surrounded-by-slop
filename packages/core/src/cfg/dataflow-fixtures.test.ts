import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stableStringify } from "../stable-json.js";
import { extractDataflow } from "./dataflow.js";

/**
 * Golden-fixture harness for def-use dataflow (`fixtures/dataflow/*`), same
 * rules as the CFG and analysis harnesses: regenerate with
 * UPDATE_FIXTURES=1 pnpm test and review the diff like code.
 */

const fixturesRoot = fileURLToPath(new URL("../../fixtures/dataflow", import.meta.url));
const update = process.env.UPDATE_FIXTURES === "1";

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

const cases = listCases();

describe.each(cases)("dataflow fixture $name", ({ directory }) => {
  it("matches its golden def-use record and is deterministic", () => {
    const input = fs
      .readdirSync(directory)
      .find((name) => name.startsWith("input.") && name !== "input.json");
    expect(input, "input.* present").toBeDefined();
    const file = {
      path: input as string,
      text: fs.readFileSync(path.join(directory, input as string), "utf8"),
    };
    const result = extractDataflow(file);
    expect(result.diagnostics).toEqual([]);

    const serialized = `${stableStringify(result, 2)}\n`;
    const expectedPath = path.join(directory, "expected.json");
    if (update) {
      fs.writeFileSync(expectedPath, serialized);
    } else {
      expect(fs.existsSync(expectedPath), "expected.json missing — run UPDATE_FIXTURES=1").toBe(
        true,
      );
      expect(serialized).toBe(fs.readFileSync(expectedPath, "utf8"));
    }

    expect(stableStringify(extractDataflow(file), 2)).toBe(stableStringify(result, 2));
  });
});

it("the dataflow fixture suite covers the required shapes", () => {
  const names = new Set(cases.map((fixture) => fixture.name));
  for (const required of ["shadowing", "destructuring", "closure-capture"]) {
    expect(names.has(required), `fixture ${required} present`).toBe(true);
  }
});
