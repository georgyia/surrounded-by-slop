/**
 * Everything a command writes to, injected rather than reached for, so the whole
 * CLI is exercisable in-process by unit tests (no child processes, no real
 * stdout). `bin.ts` wires these to the actual streams.
 */
export interface CommandContext {
  cwd: string;
  write(text: string): void;
  writeError(text: string): void;
  /** Read all of stdin (for `impact -`). Absent when no stdin is available. */
  readStdin?(): string;
}

/** A context backed by string buffers — the test harness for every command. */
export function bufferContext(
  cwd: string,
  stdin?: string,
): CommandContext & { out: () => string; err: () => string } {
  let out = "";
  let err = "";
  return {
    cwd,
    write: (text) => {
      out += text;
    },
    writeError: (text) => {
      err += text;
    },
    ...(stdin === undefined ? {} : { readStdin: () => stdin }),
    out: () => out,
    err: () => err,
  };
}
