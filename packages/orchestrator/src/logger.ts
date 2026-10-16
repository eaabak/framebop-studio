import {
  type WriteStream,
  createWriteStream,
  renameSync,
  statSync,
} from "node:fs";
import type { LogEntry, LogLevel } from "@framebop/core";

const MAX_LOG_FILE_BYTES = 5 * 1024 * 1024;

export interface LoggerOptions {
  /** Appends one JSON object per line to this file when set. */
  filePath?: string;
  /** Also print to stderr. Never stdout: that carries the RPC protocol. */
  mirrorToStderr?: boolean;
  /** How many recent entries to keep in memory for the activity panel. */
  capacity?: number;
  onEntry?: (entry: LogEntry) => void;
}

export interface ScopedLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

/**
 * Structured logger. Entries are kept in a ring buffer, optionally written to
 * a file, and pushed to a listener so the interface can show them live. The
 * log is local only and is never transmitted anywhere.
 */
export class Logger {
  private readonly entries: LogEntry[] = [];
  private readonly capacity: number;
  private readonly stream: WriteStream | null;
  private sequence = 0;
  private closed = false;

  constructor(private readonly options: LoggerOptions = {}) {
    this.capacity = options.capacity ?? 500;
    this.stream = options.filePath ? openLogFile(options.filePath) : null;
  }

  scope(scope: string): ScopedLogger {
    const write =
      (level: LogLevel) => (message: string, data?: Record<string, unknown>) =>
        this.write(level, scope, message, data);
    return {
      debug: write("debug"),
      info: write("info"),
      warn: write("warn"),
      error: write("error"),
    };
  }

  recent(limit: number): LogEntry[] {
    return this.entries.slice(-limit);
  }

  close(): Promise<void> {
    this.closed = true;
    return new Promise((resolve) => {
      if (this.stream === null) return resolve();
      this.stream.end(resolve);
    });
  }

  private write(
    level: LogLevel,
    scope: string,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    this.sequence += 1;
    const entry: LogEntry = {
      seq: this.sequence,
      time: new Date().toISOString(),
      level,
      scope,
      message,
      ...(data === undefined ? {} : { data }),
    };
    this.entries.push(entry);
    if (this.entries.length > this.capacity) this.entries.shift();

    const line = `${JSON.stringify(entry)}\n`;
    // Entries logged during shutdown stay in memory; the file is already closed.
    if (!this.closed) this.stream?.write(line);
    // stderr is a pipe to the parent process, which may be gone.
    if (this.options.mirrorToStderr && process.stderr.writable) {
      process.stderr.write(line);
    }
    // Debug entries stay out of the interface; they are in the file.
    if (level !== "debug") this.options.onEntry?.(entry);
  }
}

function openLogFile(filePath: string): WriteStream {
  try {
    // Keep one previous file so a long-running install cannot fill the disk.
    if (statSync(filePath).size > MAX_LOG_FILE_BYTES) {
      renameSync(filePath, `${filePath}.1`);
    }
  } catch {
    // No existing log file yet.
  }
  const stream = createWriteStream(filePath, { flags: "a" });
  // A failing log file must never take the engine down with it.
  stream.on("error", () => {});
  return stream;
}
