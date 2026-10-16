/**
 * Managed model storage.
 *
 * Each installation gets its own folder, named after its installation id, in
 * the managed storage root:
 *
 *   <root>/<installation id>/
 *     .framebop-model.json      ownership marker and file manifest
 *     <files, at their repository paths>
 *     <file>.part               unfinished downloads
 *
 * Removal never deletes a directory tree. It deletes the exact files the
 * manifest names, only inside the installation folder, never following a
 * symbolic link, and then removes folders only if they are empty. Anything it
 * does not recognise is left in place and reported.
 */
import { constants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  readFile,
  realpath,
  rmdir,
  stat,
  statfs,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve } from "node:path";
import { AppError, type ModelFile } from "@framebop/core";

export const MARKER_FILE = ".framebop-model.json";

export interface InstallationMarker {
  format: "framebop.model-installation";
  installationId: string;
  modelId: string;
  repoId: string;
  revision: string;
  files: { path: string; sizeBytes: number }[];
  installedAt: string;
}

function isInside(parent: string, child: string): boolean {
  const fromParent = relative(parent, child);
  return (
    fromParent !== "" && !fromParent.startsWith("..") && !isAbsolute(fromParent)
  );
}

/** Resolves a repository path inside an installation folder, or refuses. */
export function pathInInstallation(
  directory: string,
  repoPath: string,
): string {
  const target = resolve(directory, ...repoPath.split("/"));
  if (!isInside(directory, target)) {
    throw new AppError(
      "VALIDATION",
      `Refusing a file path outside the model folder: ${repoPath}`,
    );
  }
  return target;
}

export function partialPathOf(finalPath: string): string {
  return `${finalPath}.part`;
}

/**
 * Checks a folder chosen as the models location: it must exist, be a real
 * folder (not a link to one), and be writable. Returns its canonical path.
 */
export async function validateStorageRoot(path: string): Promise<string> {
  if (!isAbsolute(path))
    throw new AppError("VALIDATION", "Choose a folder by its full path.");
  const info = await lstat(path).catch(() => null);
  if (!info) throw new AppError("NOT_FOUND", "That folder does not exist.");
  if (info.isSymbolicLink()) {
    throw new AppError(
      "VALIDATION",
      "Choose the folder itself, not a link to it.",
    );
  }
  if (!info.isDirectory())
    throw new AppError("VALIDATION", "That is not a folder.");
  try {
    await access(path, constants.W_OK);
  } catch {
    throw new AppError(
      "VALIDATION",
      "Framebop Studio cannot write to that folder.",
    );
  }
  if (parse(resolve(path)).root === resolve(path)) {
    throw new AppError(
      "VALIDATION",
      "Choose a folder, not the root of a drive.",
    );
  }
  return realpath(path);
}

/** Free space at `path`, measured on the nearest folder that exists. */
export async function freeBytes(path: string): Promise<number | null> {
  let current = resolve(path);
  for (;;) {
    const info = await statfs(current).catch(() => null);
    if (info) return info.bavail * info.bsize;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** Bytes currently on disk for the given files, complete or partial. */
export async function bytesOnDisk(
  directory: string,
  files: readonly Pick<ModelFile, "path">[],
): Promise<{ complete: number; partial: number }> {
  let complete = 0;
  let partial = 0;
  for (const file of files) {
    const finalPath = pathInInstallation(directory, file.path);
    complete += (await stat(finalPath).catch(() => null))?.size ?? 0;
    partial +=
      (await stat(partialPathOf(finalPath)).catch(() => null))?.size ?? 0;
  }
  return { complete, partial };
}

export async function writeMarker(
  directory: string,
  marker: InstallationMarker,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, MARKER_FILE),
    `${JSON.stringify(marker, null, 2)}\n`,
  );
}

export async function readMarker(
  directory: string,
): Promise<InstallationMarker | null> {
  try {
    const marker = JSON.parse(
      await readFile(join(directory, MARKER_FILE), "utf8"),
    ) as InstallationMarker;
    return marker.format === "framebop.model-installation" ? marker : null;
  } catch {
    return null;
  }
}

export interface RemovalReport {
  removedFiles: number;
  /** Entries left behind because Framebop did not create them. */
  leftBehind: string[];
}

/**
 * Deletes one managed installation's own files. `storageRoot` and
 * `installationId` are what the database recorded, and both must agree with
 * the folder on disk before anything is touched.
 */
export async function removeInstallationFiles(input: {
  storageRoot: string;
  directory: string;
  installationId: string;
  files: readonly Pick<ModelFile, "path">[];
}): Promise<RemovalReport> {
  const { directory, installationId } = input;
  const folder = await lstat(directory).catch(() => null);
  if (folder === null) return { removedFiles: 0, leftBehind: [] };
  if (folder.isSymbolicLink() || !folder.isDirectory()) {
    throw new AppError(
      "VALIDATION",
      "The model folder is not a plain folder; nothing was deleted.",
    );
  }
  const root = await realpath(input.storageRoot).catch(() =>
    resolve(input.storageRoot),
  );
  const real = await realpath(directory);
  // The folder must be exactly <root>/<installation id>, as Framebop made it.
  if (dirname(real) !== root || parse(real).base !== installationId) {
    throw new AppError(
      "VALIDATION",
      "The model folder is not where Framebop Studio created it; nothing was deleted.",
    );
  }
  const marker = await readMarker(directory);
  if (marker !== null && marker.installationId !== installationId) {
    throw new AppError(
      "VALIDATION",
      "The model folder belongs to a different installation; nothing was deleted.",
    );
  }

  let removedFiles = 0;
  const folders = new Set<string>();
  for (const file of input.files) {
    const finalPath = pathInInstallation(directory, file.path);
    for (const candidate of [finalPath, partialPathOf(finalPath)]) {
      const info = await lstat(candidate).catch(() => null);
      if (!info) continue;
      // A link is removed as a link; its target is never followed.
      if (info.isFile() || info.isSymbolicLink()) {
        await unlink(candidate);
        removedFiles += 1;
      }
    }
    for (
      let parent = dirname(finalPath);
      isInside(directory, parent);
      parent = dirname(parent)
    ) {
      folders.add(parent);
    }
  }
  await unlink(join(directory, MARKER_FILE)).catch(() => {});

  const leftBehind: string[] = [];
  const removeIfEmpty = async (path: string) => {
    try {
      await rmdir(path);
    } catch (error) {
      // Missing is fine; anything else means it held something we did not make.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        leftBehind.push(path);
    }
  };
  // Deepest folders first; rmdir only succeeds on empty folders.
  for (const folderPath of [...folders].sort((a, b) => b.length - a.length)) {
    await removeIfEmpty(folderPath);
  }
  await removeIfEmpty(directory);
  return { removedFiles, leftBehind };
}
