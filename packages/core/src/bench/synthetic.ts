import type { FileInput } from "../adapter.js";

/**
 * Deterministic synthetic TypeScript projects for benchmarks (SBS-090) and
 * the incremental-cache tests (SBS-091). Same size in → byte-identical
 * project out, so timings across runs and machines measure the tool, not the
 * fixture. The shape imitates a real app: folders, classes with methods,
 * cross-module imports and calls, a couple of hub modules everyone leans on.
 */
export function syntheticProject(moduleCount: number): FileInput[] {
  const files: FileInput[] = [];
  // Two hub modules, imported widely — creates the fan-in real repos have.
  files.push({
    path: "util/log.ts",
    text: "export function log(message: string): void {\n  void message;\n}\n",
  });
  files.push({
    path: "util/id.ts",
    text: "export function nextId(): number {\n  return Date.now();\n}\n",
  });

  for (let index = 0; index < moduleCount; index += 1) {
    const folder = `feature${index % 10}`;
    const lines: string[] = [`import { log } from "../util/log";`];
    if (index % 3 === 0) {
      lines.push(`import { nextId } from "../util/id";`);
    }
    if (index > 0) {
      const previous = index - 1;
      lines.push(`import { work${previous} } from "../feature${previous % 10}/mod${previous}";`);
    }
    lines.push(
      "",
      `export class Service${index} {`,
      `  private state = 0;`,
      `  step(input: number): number {`,
      `    this.state += input;`,
      `    log(String(this.state));`,
      `    return this.state;`,
      `  }`,
      `}`,
      "",
      `export function work${index}(count: number): number {`,
      `  const service = new Service${index}();`,
      `  let total = 0;`,
      `  for (let at = 0; at < count; at += 1) {`,
      `    total = service.step(at);`,
      `  }`,
      index % 3 === 0 ? `  void nextId();` : `  log("done");`,
      index > 0 ? `  return total + work${index - 1}(count - 1);` : `  return total;`,
      `}`,
      "",
    );
    files.push({ path: `${folder}/mod${index}.ts`, text: lines.join("\n") });
  }
  return files;
}
