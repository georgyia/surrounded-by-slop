import { createExporterRegistry, jsonExporter, mermaidExporter } from "@surrounded-by-slop/core";
import { optionValue, type ParsedArgs, UsageError } from "../args.js";
import type { CommandContext } from "../context.js";
import { analyzeFor, reportDiagnostics } from "./shared.js";

/**
 * `sbs export --format mermaid|json [path]` — analyze a project and render it
 * through one of the layout-free exporters. Layout formats (svg, drawio) need a
 * positioned graph and belong to the extension, not a headless text pipe.
 */
export function exportCommand(ctx: CommandContext, parsed: ParsedArgs): number {
  const registry = createExporterRegistry();
  registry.register(mermaidExporter);
  registry.register(jsonExporter);

  const format = optionValue(parsed, "format") ?? "mermaid";
  const exporter = registry.byId(format);
  if (exporter === undefined) {
    throw new UsageError(
      `unknown --format "${format}"; expected one of: ${registry
        .all()
        .map((e) => e.id)
        .join(", ")}`,
    );
  }

  const root = parsed.positionals[0] ?? ctx.cwd;
  const result = analyzeFor(ctx, parsed, root);
  reportDiagnostics(ctx, result.diagnostics);

  const direction = optionValue(parsed, "direction");
  const output = exporter.export(
    result.graph,
    direction === "TD" || direction === "LR" ? { direction } : undefined,
  );
  ctx.write(output.endsWith("\n") ? output : `${output}\n`);
  return 0;
}
