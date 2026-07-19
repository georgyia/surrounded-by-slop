#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { run } from "./cli.js";

/**
 * The only module that touches the real process: it maps stdout/stderr, stdin,
 * and the process exit code onto the pure `run()` dispatcher.
 */
const exitCode = run(process.argv.slice(2), {
  cwd: process.cwd(),
  write: (text) => process.stdout.write(text),
  writeError: (text) => process.stderr.write(text),
  // Synchronous read of fd 0 — used only by `impact -` (piped diff).
  readStdin: () => readFileSync(0, "utf8"),
});

process.exitCode = exitCode;
