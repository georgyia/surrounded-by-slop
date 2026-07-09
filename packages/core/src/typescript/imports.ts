import ts from "typescript";
import { verticesInCycles } from "../graph/scc.js";
import { externalModuleId } from "../ir/ids.js";
import { addEdge, type ProjectContext, spanOf } from "./common.js";
import { toRelativePath } from "./host.js";

/**
 * Imports phase: `imports` edges through real TS module resolution — aliases,
 * barrels and index files resolve like the bundler would, not by string
 * matching. External packages collapse to one node per package; unresolved
 * specifiers surface as diagnostics plus external nodes, never silently drop.
 */

interface ImportSite {
  specifier: string;
  reference: ts.Node;
  typeOnly: boolean;
}

export function collectFileImports(ctx: ProjectContext, sourceFile: ts.SourceFile): void {
  const relativePath = toRelativePath(sourceFile.fileName);
  const fromId = ctx.moduleIdByPath.get(relativePath);
  if (fromId === undefined) {
    return;
  }
  for (const site of findImportSites(sourceFile)) {
    const toId = resolveSpecifier(ctx, sourceFile, site);
    if (toId === undefined) {
      continue;
    }
    addEdge(ctx, "imports", fromId, toId, {
      span: spanOf(site.reference, sourceFile),
      typeOnly: site.typeOnly || undefined,
    });
  }
}

function findImportSites(sourceFile: ts.SourceFile): ImportSite[] {
  const sites: ImportSite[] = [];

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteralLike(statement.moduleSpecifier)) {
      sites.push({
        specifier: statement.moduleSpecifier.text,
        reference: statement.moduleSpecifier,
        typeOnly: statement.importClause?.isTypeOnly === true,
      });
    } else if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(statement.moduleSpecifier)
    ) {
      sites.push({
        specifier: statement.moduleSpecifier.text,
        reference: statement.moduleSpecifier,
        typeOnly: statement.isTypeOnly,
      });
    } else if (
      ts.isImportEqualsDeclaration(statement) &&
      ts.isExternalModuleReference(statement.moduleReference) &&
      ts.isStringLiteralLike(statement.moduleReference.expression)
    ) {
      sites.push({
        specifier: statement.moduleReference.expression.text,
        reference: statement.moduleReference.expression,
        typeOnly: false,
      });
    }
  }

  // Dynamic import() and require() can appear at any depth.
  const walk = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const argument = node.arguments[0];
      if (argument !== undefined && ts.isStringLiteralLike(argument)) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          sites.push({ specifier: argument.text, reference: argument, typeOnly: false });
        } else if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
          sites.push({ specifier: argument.text, reference: argument, typeOnly: false });
        }
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(sourceFile);

  return sites;
}

function resolveSpecifier(
  ctx: ProjectContext,
  sourceFile: ts.SourceFile,
  site: ImportSite,
): string | undefined {
  const resolved = ts.resolveModuleName(
    site.specifier,
    sourceFile.fileName,
    ctx.program.getCompilerOptions(),
    ctx.resolutionHost,
  ).resolvedModule;

  if (resolved !== undefined) {
    const targetId = ctx.moduleIdByPath.get(toRelativePath(resolved.resolvedFileName));
    if (targetId !== undefined) {
      return targetId;
    }
  }

  if (isRelative(site.specifier)) {
    ctx.diagnostics.push({
      severity: "warning",
      message: `unresolved import "${site.specifier}"`,
      file: toRelativePath(sourceFile.fileName),
    });
    return externalModuleNode(ctx, site.specifier);
  }
  return externalModuleNode(ctx, packageName(site.specifier));
}

function isRelative(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../") || specifier === ".";
}

/** `react/jsx-runtime` → `react`; `@scope/pkg/deep` → `@scope/pkg`. */
export function packageName(specifier: string): string {
  const segments = specifier.split("/");
  if (specifier.startsWith("@") && segments.length >= 2) {
    return `${segments[0]}/${segments[1]}`;
  }
  return segments[0] ?? specifier;
}

function externalModuleNode(ctx: ProjectContext, name: string): string {
  const existing = ctx.externalModuleIds.get(name);
  if (existing !== undefined) {
    return existing;
  }
  const id = externalModuleId(name);
  ctx.nodes.push({ id, kind: "module", name, qualifiedName: name, external: true });
  ctx.externalModuleIds.set(name, id);
  return id;
}

/**
 * Marks `inCycle` on value-import edges whose endpoints share a strongly
 * connected component. Type-only edges neither form nor carry cycles — a
 * type cycle is erased at compile time and would only add noise.
 */
export function markImportCycles(ctx: ProjectContext): void {
  const internalModuleIds = new Set(ctx.moduleIdByPath.values());
  const adjacency = new Map<string, string[]>();
  for (const id of internalModuleIds) {
    adjacency.set(id, []);
  }
  const importEdges = ctx.edges.filter(
    (edge) =>
      edge.kind === "imports" &&
      !edge.typeOnly &&
      internalModuleIds.has(edge.from) &&
      internalModuleIds.has(edge.to),
  );
  for (const edge of importEdges) {
    adjacency.get(edge.from)?.push(edge.to);
  }
  const cyclic = verticesInCycles(adjacency);
  for (const edge of importEdges) {
    if (cyclic.has(edge.from) && cyclic.has(edge.to)) {
      edge.inCycle = true;
    }
  }
}
