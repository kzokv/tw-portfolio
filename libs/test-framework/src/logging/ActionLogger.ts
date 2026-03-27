import { appendFileSync } from "node:fs";
import type { TActionLogger } from "../core/types.js";

export interface TActionLoggerOptions {
  testName?: string;
  jsonlPath?: string;
}

type TJsonlLevel = "info" | "warn" | "browser-error";

export class ActionLogger implements TActionLogger {
  private readonly startTime: number;
  private readonly testName: string | undefined;
  private readonly jsonlPath: string | undefined;
  private readonly errorBuffer: string[] = [];

  constructor(options: TActionLoggerOptions) {
    this.startTime = performance.now();
    this.testName = options.testName;
    this.jsonlPath = options.jsonlPath;
  }

  info(message: string): void {
    console.info(this.formatConsoleMessage(message));
    this.writeJsonl(message, "info");
  }

  warn(message: string): void {
    console.warn(this.formatConsoleMessage(message));
    this.writeJsonl(message, "warn");
  }

  pushError(error: string): void {
    this.errorBuffer.push(error);
  }

  drainErrors(): string[] {
    const errors = [...this.errorBuffer];
    this.errorBuffer.length = 0;
    return errors;
  }

  logDrainedErrors(duringAction: string): void {
    const errors = this.drainErrors();
    for (const error of errors) {
      console.error(this.formatConsoleMessage(`[browser-error] ${error}`));
      this.writeJsonl(error, "browser-error", duringAction);
    }
  }

  private formatConsoleMessage(message: string): string {
    const elapsed = (performance.now() - this.startTime) / 1000;
    const timestamp = `+${elapsed.toFixed(2)}s`;
    if (this.testName) {
      return `[${timestamp}] [${this.testName}] ${message}`;
    }
    return `[${timestamp}] ${message}`;
  }

  private writeJsonl(message: string, level: TJsonlLevel, duringAction?: string): void {
    if (!this.jsonlPath) return;

    const entry: Record<string, string> = {
      ts: new Date().toISOString(),
      test: this.testName ?? "",
      action: message,
      level,
    };
    if (duringAction) {
      entry.duringAction = duringAction;
    }
    appendFileSync(this.jsonlPath, JSON.stringify(entry) + "\n");
  }
}
