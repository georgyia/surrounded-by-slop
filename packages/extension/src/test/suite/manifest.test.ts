import * as assert from "node:assert";
import { DEFAULT_EXCLUDE, DEFAULT_INCLUDE, expandBraces } from "@surrounded-by-slop/host/decisions";
import * as vscode from "vscode";
import { test } from "../harness.js";

const EXTENSION_ID = "georgyia.surrounded-by-slop";

interface Contributes {
  readonly commands: ReadonlyArray<{ readonly command: string; readonly category?: string }>;
  readonly menus?: Readonly<Record<string, ReadonlyArray<{ readonly command?: string }>>>;
  readonly keybindings?: ReadonlyArray<{ readonly command: string }>;
  readonly configuration?: {
    readonly properties?: Readonly<Record<string, { readonly description?: string }>>;
  };
}

test("every menu and keybinding points at a declared, registered Slop command", async () => {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, "extension present");
  await extension.activate();

  const contributes = (extension.packageJSON as { contributes: Contributes }).contributes;
  const declared = new Set(contributes.commands.map((entry) => entry.command));
  const registered = new Set(await vscode.commands.getCommands(true));

  // Everything referenced by a menu or keybinding must be a command we declared.
  const referenced: string[] = [];
  for (const items of Object.values(contributes.menus ?? {})) {
    for (const item of items) {
      if (item.command !== undefined) {
        referenced.push(item.command);
      }
    }
  }
  for (const binding of contributes.keybindings ?? []) {
    referenced.push(binding.command);
  }
  for (const command of referenced) {
    assert.ok(declared.has(command), `menu/keybinding references undeclared command '${command}'`);
  }

  // Every declared command is namespaced, categorized under Slop, and actually registered.
  for (const entry of contributes.commands) {
    assert.ok(entry.command.startsWith("slop."), `'${entry.command}' is not namespaced`);
    assert.strictEqual(entry.category, "Slop", `'${entry.command}' is not in the Slop category`);
    assert.ok(registered.has(entry.command), `'${entry.command}' is not registered at runtime`);
  }
});

test("every contributed setting is namespaced and has a description and default", async () => {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, "extension present");
  const contributes = (extension.packageJSON as { contributes: Contributes }).contributes;
  const properties = contributes.configuration?.properties ?? {};

  const keys = Object.keys(properties);
  assert.ok(keys.length > 0, "settings are declared");
  for (const key of keys) {
    const property = properties[key] as { description?: string; default?: unknown };
    assert.ok(key.startsWith("slop."), `setting '${key}' is namespaced`);
    assert.ok(
      typeof property.description === "string" && property.description.length > 0,
      `setting '${key}' has a description`,
    );
    assert.ok("default" in property, `setting '${key}' has a default`);
  }
});

/**
 * The marketplace's documented allowed values. `vsce package` does *not*
 * validate categories — a wrong one packages happily and is only rejected
 * once the release tag tries to publish, which is the worst place to find out.
 * https://code.visualstudio.com/api/references/extension-manifest
 */
const MARKETPLACE_CATEGORIES = new Set([
  "Programming Languages",
  "Snippets",
  "Linters",
  "Themes",
  "Debuggers",
  "Formatters",
  "Keymaps",
  "SCM Providers",
  "Other",
  "Extension Packs",
  "Language Packs",
  "Data Science",
  "Machine Learning",
  "Visualization",
  "Notebooks",
  "Education",
  "Testing",
]);

test("the marketplace listing declares valid categories and an icon", async () => {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, "extension present");
  const manifest = extension.packageJSON as {
    categories?: readonly string[];
    keywords?: readonly string[];
    icon?: string;
    description?: string;
  };

  const categories = manifest.categories ?? [];
  assert.ok(categories.length > 0, "at least one category, or the listing is unbrowsable");
  for (const category of categories) {
    assert.ok(
      MARKETPLACE_CATEGORIES.has(category),
      `'${category}' is not a marketplace category — publishing would reject it`,
    );
  }
  assert.strictEqual(new Set(categories).size, categories.length, "categories are unique");

  // The marketplace shows at most the first few keywords, and a listing with
  // no icon or summary renders as a blank card.
  assert.ok((manifest.keywords ?? []).length > 0, "keywords drive marketplace search");
  assert.ok(
    typeof manifest.icon === "string" && manifest.icon.length > 0,
    "an icon is required for the listing",
  );
  assert.ok(
    typeof manifest.description === "string" && manifest.description.length > 0,
    "a description is required for the listing",
  );
});

/**
 * The list of analyzable extensions is written twice — here in the manifest,
 * where VS Code reads it directly, and in the shared `DEFAULT_INCLUDE` the CLI
 * uses. They have drifted before (#133): the extension gained five languages
 * the shared default never got, and nothing failed, because nothing compared
 * them. This is that comparison.
 *
 * Extensions are compared, not glob spelling: the two are allowed to differ in
 * how they brace or order things, never in which languages they cover.
 */
function extensionsOf(globs: readonly string[]): Set<string> {
  const suffixes = new Set<string>();
  for (const glob of globs) {
    for (const expanded of expandBraces(glob)) {
      const dot = expanded.lastIndexOf(".");
      if (dot !== -1) {
        suffixes.add(expanded.slice(dot).toLowerCase());
      }
    }
  }
  return suffixes;
}

test("the manifest's default include glob covers exactly the shared DEFAULT_INCLUDE", async () => {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, "extension present");
  const contributes = (extension.packageJSON as { contributes: Contributes }).contributes;
  const property = contributes.configuration?.properties?.["slop.include"] as
    | { default?: string[] }
    | undefined;
  assert.ok(property?.default, "slop.include declares a default");

  const manifest = extensionsOf(property.default);
  const shared = extensionsOf([...DEFAULT_INCLUDE]);
  const missingFromManifest = [...shared].filter((suffix) => !manifest.has(suffix)).sort();
  const missingFromShared = [...manifest].filter((suffix) => !shared.has(suffix)).sort();

  assert.deepStrictEqual(
    missingFromManifest,
    [],
    `slop.include is missing ${missingFromManifest.join(", ")} — add them to packages/extension/package.json`,
  );
  assert.deepStrictEqual(
    missingFromShared,
    [],
    `DEFAULT_INCLUDE is missing ${missingFromShared.join(", ")} — add them to packages/host/src/decisions.ts`,
  );
});

test("the manifest's default exclude list matches the shared DEFAULT_EXCLUDE", async () => {
  // Same drift risk as slop.include (#133): the CLI and the editor must skip
  // the same build output, or a repo maps differently depending on where you
  // ask from.
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, "extension present");
  const contributes = (extension.packageJSON as { contributes: Contributes }).contributes;
  const property = contributes.configuration?.properties?.["slop.exclude"] as
    | { default?: string[] }
    | undefined;
  assert.ok(property?.default, "slop.exclude declares a default");

  const manifest = new Set(property.default);
  const shared = new Set<string>(DEFAULT_EXCLUDE);
  const missingFromManifest = [...shared].filter((glob) => !manifest.has(glob)).sort();
  const missingFromShared = [...manifest].filter((glob) => !shared.has(glob)).sort();

  assert.deepStrictEqual(
    missingFromManifest,
    [],
    `slop.exclude is missing ${missingFromManifest.join(", ")} — add them to packages/extension/package.json`,
  );
  assert.deepStrictEqual(
    missingFromShared,
    [],
    `DEFAULT_EXCLUDE is missing ${missingFromShared.join(", ")} — add them to packages/host/src/decisions.ts`,
  );
});
