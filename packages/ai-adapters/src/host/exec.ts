import { execFile, spawn } from "node:child_process";

export interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export interface CommandOptions {
  timeoutMs?: number;
  maxOutputBytes?: number;
  signal?: AbortSignal;
  /** Environment for the program. Defaults to the engine's own. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Runs a program with an argument array and no shell, so arguments are never
 * interpreted. This is the only way the engine launches external commands.
 * Never rejects: a missing binary, non-zero exit or timeout yields `ok: false`.
 */
export function runCommand(
  file: string,
  args: readonly string[],
  options: CommandOptions = {},
): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(
      file,
      [...args],
      {
        timeout: options.timeoutMs ?? 10_000,
        maxBuffer: options.maxOutputBytes ?? 4 * 1024 * 1024,
        windowsHide: true,
        signal: options.signal,
        env: options.env,
      },
      (error, stdout, stderr) => {
        resolve({ ok: error === null, stdout, stderr });
      },
    );
  });
}

export interface ProcessResult {
  /** Null when the process was killed by a signal. */
  exitCode: number | null;
  /** The last part of what the process printed, for error messages. */
  outputTail: string;
}

export interface ProcessOptions {
  /** Aborting sends a polite stop request, then kills the process. */
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  /** Receives output as it arrives, for progress a tool prints. */
  onOutput?(text: string): void;
}

const OUTPUT_TAIL_BYTES = 8 * 1024;
const KILL_GRACE_MS = 5000;

/**
 * Runs a long-lived program to completion without a shell and without
 * buffering its whole output, which for a generation tool can be an endless
 * stream of progress lines. Rejects only if the program cannot be started.
 */
export function runProcess(
  file: string,
  args: readonly string[],
  options: ProcessOptions = {},
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, [...args], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: options.env,
    });

    let tail = Buffer.alloc(0);
    const keep = (chunk: Buffer) => {
      tail = Buffer.concat([tail, chunk]).subarray(-OUTPUT_TAIL_BYTES);
      options.onOutput?.(chunk.toString("utf8"));
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);

    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      child.kill("SIGTERM");
      // A tool busy inside a model may ignore the request; do not wait forever.
      killTimer = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
    };
    if (options.signal?.aborted) stop();
    options.signal?.addEventListener("abort", stop, { once: true });

    child.once("error", (error) => {
      clearTimeout(killTimer);
      options.signal?.removeEventListener("abort", stop);
      reject(error);
    });
    child.once("close", (exitCode) => {
      clearTimeout(killTimer);
      options.signal?.removeEventListener("abort", stop);
      resolve({ exitCode, outputTail: tail.toString("utf8") });
    });
  });
}

/**
 * Runs a short program and writes `input` to its standard input, for data
 * that must not appear in the argument list (which other processes on the
 * computer can read). Never rejects, like `runCommand`.
 */
export function runCommandWithInput(
  file: string,
  args: readonly string[],
  input: string,
  options: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<CommandResult & { exitCode: number | null }> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(file, [...args], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        env: options.env,
      });
    } catch {
      resolve({ ok: false, stdout: "", stderr: "", exitCode: null });
      return;
    }
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    const timer = setTimeout(
      () => child.kill("SIGKILL"),
      options.timeoutMs ?? 10_000,
    );
    child.once("error", () => {
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr, exitCode: null });
    });
    child.once("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ ok: exitCode === 0, stdout, stderr, exitCode });
    });
    child.stdin?.on("error", () => {});
    child.stdin?.end(input);
  });
}
