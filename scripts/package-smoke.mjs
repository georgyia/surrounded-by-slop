/** Pack the public npm packages, audit their contents, then run `npx sbs` in a clean project. */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

const root = resolve(import.meta.dirname, "..");
const scratch = mkdtempSync(join(tmpdir(), "sbs-pack-"));
const packDir = join(scratch, "packs");
const project = join(scratch, "project");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    cwd: options.cwd ?? root,
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status})\n${result.stderr ?? ""}`,
    );
  }
  return result.stdout ?? "";
}

function tarEntries(path) {
  const bytes = gunzipSync(readFileSync(path));
  const entries = [];
  for (let offset = 0; offset + 512 <= bytes.length; ) {
    const header = bytes.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    if (name === "") break;
    const sizeText = header.subarray(124, 136).toString("ascii").replace(/\0.*$/, "").trim();
    const size = Number.parseInt(sizeText || "0", 8);
    entries.push(name);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function pack(packageName) {
  const packageDir = join(root, "packages", packageName);
  const before = new Set(readdirSync(packDir, { recursive: false }));
  run("pnpm", ["pack", "--pack-destination", packDir], { cwd: packageDir });
  const archiveName = readdirSync(packDir).find(
    (name) => !before.has(name) && name.endsWith(".tgz"),
  );
  if (archiveName === undefined) {
    throw new Error(`pnpm pack produced no archive for ${packageName}`);
  }
  const archive = join(packDir, archiveName);
  const files = tarEntries(archive);
  const forbidden = files.filter(
    (file) =>
      /(^|\/)(src|fixtures|test-fixtures)(\/|$)/.test(file) ||
      /\.test\.[^.]+$/.test(file) ||
      file.endsWith(".map"),
  );
  if (forbidden.length > 0) {
    throw new Error(`${packageName} archive contains forbidden files:\n${forbidden.join("\n")}`);
  }
  console.log(`${packageName}: ${files.length} clean archive entries`);
  return archive;
}

try {
  mkdirSync(packDir, { recursive: true });
  const core = pack("core");
  const cli = pack("cli");
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, "package.json"), '{"private":true}\n');
  writeFileSync(join(project, "app.ts"), "export function hello(): string { return 'hello'; }\n");
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", core, cli], {
    cwd: project,
  });
  const installedCli = JSON.parse(
    readFileSync(join(project, "node_modules/@surrounded-by-slop/cli/package.json"), "utf8"),
  );
  if (installedCli.dependencies?.["@surrounded-by-slop/host"] !== undefined) {
    throw new Error("the private host package leaked into the published CLI dependencies");
  }
  const installedCliRoot = join(project, "node_modules/@surrounded-by-slop/cli");
  const leakedDeclarations = readdirSync(installedCliRoot, { recursive: true })
    .filter((file) => typeof file === "string" && file.endsWith(".d.ts"))
    .filter((file) =>
      readFileSync(join(installedCliRoot, file), "utf8").includes("@surrounded-by-slop/host"),
    );
  if (leakedDeclarations.length > 0) {
    throw new Error(
      `the private host package leaked into CLI types:\n${leakedDeclarations.join("\n")}`,
    );
  }
  writeFileSync(
    join(project, "consumer.ts"),
    [
      'import { layoutGraph } from "@surrounded-by-slop/core";',
      'import { discoverFiles } from "@surrounded-by-slop/cli";',
      'void discoverFiles(".");',
      "void layoutGraph({ schemaVersion: 1, nodes: [], edges: [] });",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(project, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          target: "ES2022",
          strict: true,
          noEmit: true,
        },
        include: ["consumer.ts"],
      },
      null,
      2,
    )}\n`,
  );
  run("npx", ["--no-install", "tsc", "-p", "tsconfig.json"], { cwd: project });
  run(
    "node",
    ["-e", "import('@surrounded-by-slop/core').then(m => { if (!m.layoutGraph) process.exit(1) })"],
    { cwd: project },
  );
  const output = run("npx", ["--no-install", "sbs", "map", "."], {
    cwd: project,
    capture: true,
  });
  if (!output.includes("app.ts") || !output.includes("hello")) {
    throw new Error(`packed CLI did not analyze the clean sample project:\n${output}`);
  }
  console.log("clean install: npx --no-install sbs map . passed");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
