/**
 * Runs a tool and hands over its output line by line as it arrives, so a
 * long video is analysed with bounded memory. No shell is involved: the
 * arguments are passed as they are, and a file name can never become a
 * command. Aborting ends the process, politely first.
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export interface StreamResult {
  exitCode: number | null;
  /** The last few error lines, for a message when the tool fails. */
  tail: string[];
}

export function streamCommand(
  program: string,
  args: readonly string[],
  options: {
    signal: AbortSignal;
    onStdout?(line: string): void;
    onStderr?(line: string): void;
  },
): Promise<StreamResult> {
  return new Promise((resolve, reject) => {
    if (options.signal.aborted) {
      reject(options.signal.reason);
      return;
    }
    const child = spawn(program, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const tail: string[] = [];
    let killer: NodeJS.Timeout | null = null;
    const onAbort = () => {
      child.kill("SIGTERM");
      killer = setTimeout(() => child.kill("SIGKILL"), 3000);
    };
    options.signal.addEventListener("abort", onAbort, { once: true });

    createInterface({ input: child.stdout }).on("line", (line) =>
      options.onStdout?.(line),
    );
    createInterface({ input: child.stderr }).on("line", (line) => {
      tail.push(line);
      if (tail.length > 20) tail.shift();
      options.onStderr?.(line);
    });

    child.on("error", (error) => {
      options.signal.removeEventListener("abort", onAbort);
      reject(error);
    });
    child.on("close", (exitCode) => {
      options.signal.removeEventListener("abort", onAbort);
      if (killer) clearTimeout(killer);
      if (options.signal.aborted) reject(options.signal.reason);
      else resolve({ exitCode, tail });
    });
  });
}
