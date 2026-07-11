import * as vscode from "vscode";

export type LogLevel = "info" | "warn" | "error";

export interface LogRecord {
  readonly level: LogLevel;
  readonly message: string;
}

/**
 * The single place errors and warnings go. Users see a one-line notification;
 * the full detail lands in the `Surrounded by Slop` output channel so a bug
 * report has something to attach. `onDidLog` exists so integration tests can
 * assert what was logged (the channel itself has no read API).
 */
export class Logger implements vscode.Disposable {
  private readonly channel: vscode.OutputChannel;
  private readonly emitter = new vscode.EventEmitter<LogRecord>();

  /** Fires for every log entry, in order. */
  readonly onDidLog = this.emitter.event;

  constructor() {
    this.channel = vscode.window.createOutputChannel("Surrounded by Slop");
  }

  info(message: string): void {
    this.record("info", message);
  }

  warn(message: string): void {
    this.record("warn", message);
  }

  error(message: string, detail?: unknown): void {
    this.record("error", message);
    if (detail !== undefined) {
      this.channel.appendLine(formatDetail(detail));
    }
  }

  /** Tell the user once, keep the whole story: a notification plus a channel entry. */
  report(userMessage: string, detail: unknown): void {
    this.error(userMessage, detail);
    void vscode.window.showErrorMessage(userMessage, "Show Log").then((choice) => {
      if (choice === "Show Log") {
        this.show();
      }
    });
  }

  show(): void {
    this.channel.show(true);
  }

  dispose(): void {
    this.emitter.dispose();
    this.channel.dispose();
  }

  private record(level: LogLevel, message: string): void {
    this.channel.appendLine(`${new Date().toISOString()} [${level}] ${message}`);
    this.emitter.fire({ level, message });
  }
}

function formatDetail(detail: unknown): string {
  if (detail instanceof Error) {
    return detail.stack ?? `${detail.name}: ${detail.message}`;
  }
  return typeof detail === "string" ? detail : JSON.stringify(detail);
}
