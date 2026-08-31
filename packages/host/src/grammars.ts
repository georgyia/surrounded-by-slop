import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { LanguageAdapter } from "@surrounded-by-slop/core";
import {
  createCSharpAdapter,
  createGoAdapter,
  createJavaAdapter,
  createPythonAdapter,
  createRubyAdapter,
  createRustAdapter,
} from "@surrounded-by-slop/core";

/**
 * Loading tree-sitter grammars from disk (#131).
 *
 * Core stays pure — it takes grammar *bytes*, never a path (Rule 5) — and the
 * VS Code extension ships its wasm next to the bundle. Everything else (the
 * CLI, the MCP server, repo scripts) resolves grammars out of the installed
 * dependency tree, which is what this module does.
 *
 * Grammars are loaded **lazily, per language, once**: a TypeScript-only project
 * pays for none, and a long-lived MCP session parses each grammar a single
 * time. That matters — the six grammars are ~9 MB of wasm between them.
 */

interface GrammarSpec {
  /** File extensions this adapter claims, lowercase and dotted. */
  readonly extensions: readonly string[];
  /** Filename inside `@vscode/tree-sitter-wasm/wasm`. */
  readonly wasm: string;
  readonly create: (runtime: Uint8Array, grammar: Uint8Array) => Promise<LanguageAdapter>;
}

/**
 * Every non-TypeScript language, as data. TypeScript and JavaScript are absent
 * on purpose: they go through the compiler API, not tree-sitter.
 */
const GRAMMARS: readonly GrammarSpec[] = [
  {
    extensions: [".py"],
    wasm: "tree-sitter-python.wasm",
    create: (runtime, python) => createPythonAdapter({ runtime, python }),
  },
  {
    extensions: [".go"],
    wasm: "tree-sitter-go.wasm",
    create: (runtime, go) => createGoAdapter({ runtime, go }),
  },
  {
    extensions: [".java"],
    wasm: "tree-sitter-java.wasm",
    create: (runtime, java) => createJavaAdapter({ runtime, java }),
  },
  {
    extensions: [".rs"],
    wasm: "tree-sitter-rust.wasm",
    create: (runtime, rust) => createRustAdapter({ runtime, rust }),
  },
  {
    extensions: [".rb"],
    wasm: "tree-sitter-ruby.wasm",
    create: (runtime, ruby) => createRubyAdapter({ runtime, ruby }),
  },
  {
    extensions: [".cs"],
    wasm: "tree-sitter-c-sharp.wasm",
    create: (runtime, csharp) => createCSharpAdapter({ runtime, csharp }),
  },
];

/** Extensions handled by tree-sitter rather than the TypeScript compiler. */
export const TREE_SITTER_EXTENSIONS: readonly string[] = GRAMMARS.flatMap(
  (grammar) => grammar.extensions,
);

/** The tree-sitter grammar owning a path, if any. */
function grammarFor(path: string): GrammarSpec | undefined {
  const lower = path.toLowerCase();
  return GRAMMARS.find((grammar) => grammar.extensions.some((ext) => lower.endsWith(ext)));
}

/** True when the TypeScript compiler, not a grammar, should read this file. */
export function isTypeScriptPath(path: string): boolean {
  return grammarFor(path) === undefined;
}

/**
 * Grammar bytes live in core's dependency tree, so they are resolved *from
 * core* — in a published install that is `node_modules/@surrounded-by-slop/
 * core/node_modules/...` or the hoisted equivalent, and in this repo it is the
 * workspace link. Resolving from here instead would break the moment the CLI
 * is installed standalone.
 */
function grammarDirectory(): string {
  const fromHere = createRequire(import.meta.url);
  const coreRequire = createRequire(fromHere.resolve("@surrounded-by-slop/core/package.json"));
  return join(dirname(coreRequire.resolve("@vscode/tree-sitter-wasm/package.json")), "wasm");
}

const adapters = new Map<string, Promise<LanguageAdapter>>();
let runtimeBytes: Uint8Array | undefined;

function treeSitterRuntime(): Uint8Array {
  if (runtimeBytes === undefined) {
    const fromHere = createRequire(import.meta.url);
    const coreRequire = createRequire(fromHere.resolve("@surrounded-by-slop/core/package.json"));
    runtimeBytes = readFileSync(coreRequire.resolve("web-tree-sitter/web-tree-sitter.wasm"));
  }
  return runtimeBytes;
}

/**
 * Adapters for exactly the languages present in `paths` — never more.
 *
 * Returned in a stable order (the declaration order above) so a merged graph
 * is byte-identical run to run, and cached across calls so a long-lived
 * process loads each grammar once.
 */
export async function adaptersForPaths(
  paths: Iterable<string>,
): Promise<readonly LanguageAdapter[]> {
  const needed = new Set<GrammarSpec>();
  for (const path of paths) {
    const grammar = grammarFor(path);
    if (grammar !== undefined) {
      needed.add(grammar);
    }
  }
  const ordered = GRAMMARS.filter((grammar) => needed.has(grammar));
  return Promise.all(
    ordered.map((grammar) => {
      const cached = adapters.get(grammar.wasm);
      if (cached !== undefined) {
        return cached;
      }
      const loading = grammar.create(
        treeSitterRuntime(),
        readFileSync(join(grammarDirectory(), grammar.wasm)),
      );
      adapters.set(grammar.wasm, loading);
      return loading;
    }),
  );
}
