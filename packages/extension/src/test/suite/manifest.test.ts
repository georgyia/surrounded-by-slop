import * as assert from "node:assert";
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
