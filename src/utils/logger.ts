/**
 * @module utils/logger
 *
 * Centralized logging utility for the Copilot Code Review extension.
 *
 * Purpose: Provides a singleton OutputChannel-based logger that writes
 * timestamped, leveled messages to the "Copilot Code Review" output panel.
 *
 * Usage: Import `logger` and call `logger.info(...)`, `logger.warn(...)`, etc.
 */

import * as vscode from "vscode";

/**
 * Log level for filtering output verbosity.
 */
type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Logger writes timestamped messages to a VS Code Output Channel.
 *
 * Access it in the Extension Development Host via:
 * Output panel → dropdown → "Copilot Code Review"
 */
class Logger {
  private channel: vscode.OutputChannel | undefined;
  private minLevel: LogLevel = "debug";

  /**
   * Initializes the output channel. Call once during `activate()`.
   */
  public init(): void {
    if (this.channel === undefined) {
      this.channel = vscode.window.createOutputChannel("Copilot Code Review");
    }
  }

  /**
   * Returns the output channel disposable for cleanup.
   */
  public getChannel(): vscode.OutputChannel | undefined {
    return this.channel;
  }

  public debug(message: string, ...data: unknown[]): void {
    this.log("debug", message, ...data);
  }

  public info(message: string, ...data: unknown[]): void {
    this.log("info", message, ...data);
  }

  public warn(message: string, ...data: unknown[]): void {
    this.log("warn", message, ...data);
  }

  public error(message: string, ...data: unknown[]): void {
    this.log("error", message, ...data);
  }

  private log(level: LogLevel, message: string, ...data: unknown[]): void {
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[this.minLevel]) {
      return;
    }

    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    const suffix =
      data.length > 0 ? " " + data.map((d) => JSON.stringify(d)).join(" ") : "";

    const line = `${prefix} ${message}${suffix}`;

    if (this.channel !== undefined) {
      this.channel.appendLine(line);
    }
  }
}

/**
 * Singleton logger instance. Call `logger.init()` in `activate()`.
 */
export const logger = new Logger();
