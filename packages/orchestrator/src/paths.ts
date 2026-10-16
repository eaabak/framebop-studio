import { mkdir, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { AppError } from "@framebop/core";

/**
 * On-disk layout of a library. Everything the application owns lives under
 * one data directory, so backing up, moving or removing a library is a
 * single-folder operation:
 *
 *   <dataDir>/framebop.db                      SQLite database
 *   <dataDir>/media/<projectId>/<assetId>.ext  managed copies of media
 *   <dataDir>/media/<projectId>/thumbs/        generated thumbnails
 *   <dataDir>/work/<jobId>/                    scratch space of a running job
 *   <dataDir>/engine.lock                      held while an engine has it open
 *   <dataDir>/logs/engine.log                  engine log
 */
export interface LibraryPaths {
  dataDir: string;
  databasePath: string;
  mediaRoot: string;
  /** Scratch space for running jobs. Emptied at every start. */
  workRoot: string;
  /** Marks the library as open by one engine process. See lock.ts. */
  lockPath: string;
  logsDir: string;
  logFile: string;
}

export function resolveLibraryPaths(dataDir: string): LibraryPaths {
  if (!isAbsolute(dataDir)) {
    throw new AppError(
      "VALIDATION",
      "The data directory must be an absolute path.",
    );
  }
  const root = resolve(dataDir);
  const logsDir = join(root, "logs");
  return {
    dataDir: root,
    databasePath: join(root, "framebop.db"),
    mediaRoot: join(root, "media"),
    workRoot: join(root, "work"),
    lockPath: join(root, "engine.lock"),
    logsDir,
    logFile: join(logsDir, "engine.log"),
  };
}

export async function ensureLibraryDirectories(
  paths: LibraryPaths,
): Promise<void> {
  await mkdir(paths.mediaRoot, { recursive: true });
  await mkdir(paths.logsDir, { recursive: true });
}

/**
 * Empties the scratch folder. Whatever is in it belonged to jobs of an
 * earlier process, none of which can still be running.
 */
export async function resetWorkDirectory(paths: LibraryPaths): Promise<void> {
  await rm(paths.workRoot, { recursive: true, force: true });
  await mkdir(paths.workRoot, { recursive: true });
}

/**
 * Turns a library-relative media path (always forward-slashed, as stored in
 * the database) into an absolute path, refusing anything that would resolve
 * outside the media root. Every read, write and delete of a media file goes
 * through this check.
 */
export function resolveMediaPath(
  mediaRoot: string,
  relativePath: string,
): string {
  const absolute = resolve(mediaRoot, ...relativePath.split("/"));
  const fromRoot = relative(mediaRoot, absolute);
  if (fromRoot === "" || fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new AppError("VALIDATION", "Media path escapes the library.");
  }
  return absolute;
}
