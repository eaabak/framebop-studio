import { stat } from "node:fs/promises";
import { delimiter, join } from "node:path";
import type { ToolStatus } from "@framebop/core";
import { runCommand } from "./exec";
import type { HostPlatform } from "./platform";

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** Finds a command-line program on PATH, then in the host's usual tool directories. */
export async function locateExecutable(
  host: HostPlatform,
  program: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const pathDirectories = (env.PATH ?? env.Path ?? "")
    .split(delimiter)
    .filter((directory) => directory.length > 0);
  const directories = new Set([...pathDirectories, ...host.toolDirectories()]);
  const fileName = host.executableName(program);
  for (const directory of directories) {
    const candidate = join(directory, fileName);
    if (await isFile(candidate)) return candidate;
  }
  return null;
}

const UNAVAILABLE: ToolStatus = { available: false, path: null, version: null };

/**
 * Locates an FFmpeg-family tool and confirms it actually runs. A binary that
 * exists but fails to start is reported as unavailable.
 */
export async function probeFfmpegTool(
  host: HostPlatform,
  program: "ffmpeg" | "ffprobe",
  env: NodeJS.ProcessEnv = process.env,
): Promise<ToolStatus> {
  const path = await locateExecutable(host, program, env);
  if (path === null) return UNAVAILABLE;
  const result = await runCommand(path, ["-version"], { timeoutMs: 5000 });
  if (!result.ok) return UNAVAILABLE;
  const version = /version\s+(\S+)/.exec(result.stdout)?.[1] ?? null;
  return { available: true, path, version };
}
