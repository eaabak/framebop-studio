/**
 * The browser that draws a video's frames. Framebop carries its own copy of
 * Remotion's Chrome Headless Shell next to its renderer, so nobody has to
 * find, choose or install one. A browser chosen in Settings is used instead
 * only when it really is a program.
 */
import { accessSync, constants, statSync } from "node:fs";
import { dirname, join } from "node:path";

/** Remotion's names for its builds, by Node's platform and architecture. */
const BUILDS: Record<string, string> = {
  "darwin-arm64": "mac-arm64",
  "darwin-x64": "mac-x64",
  "linux-x64": "linux64",
  "win32-x64": "win64",
};

/** Whether `path` is a file this computer can run. */
export function isProgram(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (process.platform === "win32") return /\.exe$/i.test(path);
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Framebop's own copy, found next to the renderer it serves. */
export function bundledRenderBrowser(workerPath: string): string | null {
  const build = BUILDS[`${process.platform}-${process.arch}`];
  if (!build) return null;
  const program = `chrome-headless-shell${process.platform === "win32" ? ".exe" : ""}`;
  const renderer = dirname(workerPath);
  const candidates = [
    // In development: where Remotion's ensureBrowser puts it.
    join(
      renderer,
      "..",
      "node_modules",
      ".remotion",
      "chrome-headless-shell",
      build,
      `chrome-headless-shell-${build}`,
      program,
    ),
    // In an installed app: shipped with the renderer.
    join(renderer, "browser", program),
  ];
  return candidates.find(isProgram) ?? null;
}

/** The chosen browser if it can run, else Framebop's own, else the choice. */
export function renderBrowser(
  chosen: string | null,
  workerPath: string,
): string | null {
  if (chosen && isProgram(chosen)) return chosen;
  return bundledRenderBrowser(workerPath) ?? chosen;
}
