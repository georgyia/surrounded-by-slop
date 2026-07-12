import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stableStringify } from "../stable-json.js";
import { extractControlFlow } from "./builder.js";
import { validateCfg } from "./validate.js";

/**
 * Golden-fixture harness for control-flow graphs (`fixtures/cfg/*`), the CFG
 * counterpart of the analysis harness. Same rules, same workflow:
 * regenerate with  UPDATE_FIXTURES=1 pnpm test  and review the diff like code.
 * Every case must pass `validateCfg` and a double-run determinism check.
 */

const fixturesRoot = fileURLToPath(new URL("../../fixtures/cfg", import.meta.url));
const update = process.env.UPDATE_FIXTURES === "1";

interface FixtureCase {
  name: string;
  directory: string;
}

function listCases(): FixtureCase[] {
  if (!fs.existsSync(fixturesRoot)) {
    return [];
  }
  return fs
    .readdirSync(fixturesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, directory: path.join(fixturesRoot, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function readInput(directory: string): { path: string; text: string } {
  const input = fs
    .readdirSync(directory)
    .find((name) => name.startsWith("input.") && name !== "input.json");
  if (input === undefined) {
    throw new Error(`cfg fixture ${directory} has no input.* file`);
  }
  return { path: input, text: fs.readFileSync(path.join(directory, input), "utf8") };
}

const cases = listCases();

describe.each(cases)("cfg fixture $name", ({ directory }) => {
  it("matches its golden CFG, validates and is deterministic", () => {
    const input = readInput(directory);
    const result = extractControlFlow(input);

    for (const cfg of result.cfgs) {
      expect(validateCfg(cfg), `cfg ${cfg.name}`).toEqual([]);
    }

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

    const secondRun = extractControlFlow(input);
    expect(stableStringify(secondRun, 2)).toBe(stableStringify(result, 2));
  });
});

it("the cfg fixture suite covers at least the 20 required shapes", () => {
  expect(cases.length).toBeGreaterThanOrEqual(20);
});
