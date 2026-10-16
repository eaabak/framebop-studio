import { access, constants } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { HostOs } from "../contracts";
import { runCommand } from "./exec";

export interface InstalledApplication {
  path: string;
  version: string | null;
}

/** A folder where another application keeps its models. */
export interface KnownModelFolder {
  application: string;
  path: string;
  /** What to know before adding it. */
  note: string;
}

export interface ApplicationIdentity {
  /** Display name, also the bundle or folder name on disk. */
  name: string;
  /** macOS bundle identifier, when the application ships for macOS. */
  macosBundleId?: string;
}

/**
 * Everything the engine needs to know about the operating system it runs on.
 *
 * This is the only place allowed to contain OS-specific paths, commands or
 * conventions. Code elsewhere asks a `HostPlatform` instead of branching on
 * `process.platform`, which keeps the rest of the codebase portable and lets
 * tests substitute a fake host.
 */
export interface HostPlatform {
  readonly os: HostOs | "unknown";
  readonly arch: string;
  /** File name of a command-line program on this OS. */
  executableName(program: string): string;
  /**
   * Directories where users commonly install command-line tools, searched
   * after PATH. Needed because desktop apps often start with a minimal PATH
   * that omits package-manager directories.
   */
  toolDirectories(): string[];
  /** Resolves an installed GUI application, or null if absent or unsupported. */
  findApplication(
    identity: ApplicationIdentity,
  ): Promise<InstalledApplication | null>;
  /**
   * Where other applications usually keep models on this OS. Only offered
   * as suggestions: nothing here is read until the user adds the folder.
   */
  knownModelFolders?(): KnownModelFolder[];
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function compact(values: (string | undefined)[]): string[] {
  return values.filter((value): value is string => Boolean(value));
}

class MacosHost implements HostPlatform {
  readonly os = "macos";
  constructor(readonly arch: string) {}

  knownModelFolders(): KnownModelFolder[] {
    return [
      {
        application: "Draw Things",
        // Draw Things' default models folder inside its sandbox container,
        // which is also draw-things-cli's default --models-dir.
        path: join(
          homedir(),
          "Library/Containers/com.liuliu.draw-things/Data/Documents/Models",
        ),
        note: "Listed read-only. macOS may ask whether Framebop Studio may access Draw Things' data. Draw Things' own files run only through Draw Things or its command-line tool.",
      },
    ];
  }

  executableName(program: string): string {
    return program;
  }

  toolDirectories(): string[] {
    // Homebrew (Apple Silicon, then Intel) and MacPorts.
    return ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"];
  }

  async findApplication(
    identity: ApplicationIdentity,
  ): Promise<InstalledApplication | null> {
    const bundle = `${identity.name}.app`;
    const candidates = [
      join("/Applications", bundle),
      join(homedir(), "Applications", bundle),
    ];
    let path: string | null = null;
    for (const candidate of candidates) {
      if (await exists(candidate)) {
        path = candidate;
        break;
      }
    }
    // Applications can live anywhere on macOS, so fall back to Spotlight.
    if (path === null && identity.macosBundleId) {
      path = await this.findByBundleId(identity.macosBundleId);
    }
    if (path === null) return null;
    return { path, version: await this.readBundleVersion(path) };
  }

  private async findByBundleId(bundleId: string): Promise<string | null> {
    // The identifier is interpolated into a Spotlight query, so reject
    // anything that is not a plain reverse-DNS name.
    if (!/^[A-Za-z0-9.-]+$/.test(bundleId)) return null;
    const result = await runCommand("/usr/bin/mdfind", [
      `kMDItemCFBundleIdentifier == '${bundleId}'`,
    ]);
    if (!result.ok) return null;
    const match = result.stdout
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.endsWith(".app"));
    return match ?? null;
  }

  private async readBundleVersion(appPath: string): Promise<string | null> {
    const result = await runCommand("/usr/bin/plutil", [
      "-extract",
      "CFBundleShortVersionString",
      "raw",
      "-o",
      "-",
      join(appPath, "Contents", "Info.plist"),
    ]);
    const version = result.ok ? result.stdout.trim() : "";
    return version.length > 0 ? version : null;
  }
}

class WindowsHost implements HostPlatform {
  readonly os = "windows";
  constructor(
    readonly arch: string,
    private readonly env: NodeJS.ProcessEnv,
  ) {}

  executableName(program: string): string {
    return `${program}.exe`;
  }

  toolDirectories(): string[] {
    const { env } = this;
    // winget, Scoop and Chocolatey shims, then a conventional manual install.
    return compact([
      env.LOCALAPPDATA &&
        join(env.LOCALAPPDATA, "Microsoft", "WinGet", "Links"),
      env.USERPROFILE && join(env.USERPROFILE, "scoop", "shims"),
      env.ChocolateyInstall && join(env.ChocolateyInstall, "bin"),
      env.ProgramFiles && join(env.ProgramFiles, "ffmpeg", "bin"),
    ]);
  }

  async findApplication(): Promise<InstalledApplication | null> {
    // No engine integrated so far ships as a Windows GUI application.
    return null;
  }
}

class LinuxHost implements HostPlatform {
  readonly os = "linux";
  constructor(readonly arch: string) {}

  executableName(program: string): string {
    return program;
  }

  toolDirectories(): string[] {
    return [
      "/usr/local/bin",
      "/usr/bin",
      join(homedir(), ".local", "bin"),
      "/snap/bin",
    ];
  }

  async findApplication(): Promise<InstalledApplication | null> {
    return null;
  }
}

class UnknownHost implements HostPlatform {
  readonly os = "unknown";
  constructor(readonly arch: string) {}

  executableName(program: string): string {
    return program;
  }

  toolDirectories(): string[] {
    return [];
  }

  async findApplication(): Promise<InstalledApplication | null> {
    return null;
  }
}

export function createHostPlatform(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  env: NodeJS.ProcessEnv = process.env,
): HostPlatform {
  switch (platform) {
    case "darwin":
      return new MacosHost(arch);
    case "win32":
      return new WindowsHost(arch, env);
    case "linux":
      return new LinuxHost(arch);
    default:
      return new UnknownHost(arch);
  }
}
