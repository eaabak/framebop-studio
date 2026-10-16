/**
 * Read-only discovery of models that something other than Framebop Studio
 * manages: the Hugging Face cache, and folders the user points at.
 *
 * Nothing found here is ever moved, copied, changed or deleted. Discovery
 * looks only where it is told to, to a limited depth, without following
 * symbolic links out of the folder, and never hashes large files: matching a
 * catalog model is by repository and commit for the Hugging Face cache, and
 * by exact file name and size for plain folders, which is reported as such.
 */
import type { Dirent } from "node:fs";
import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, isAbsolute, join, relative } from "node:path";
import type { CatalogEntry, ExternalModel } from "@framebop/core";

/** Extensions that hold model weights. Generic ones such as .bin are left out. */
export const MODEL_EXTENSIONS: ReadonlySet<string> = new Set([
  ".safetensors",
  ".ckpt",
  ".gguf",
  ".onnx",
  ".pth",
  ".pt",
]);
const MIN_MODEL_BYTES = 1024 * 1024;
const MAX_DEPTH = 4;
const MAX_ENTRIES = 20_000;

type Found = Omit<ExternalModel, "id" | "sourceId" | "discoveredAt">;

/** Where the Hugging Face libraries keep their shared cache. */
export function huggingFaceCachePath(
  env: NodeJS.ProcessEnv,
  home = homedir(),
): string {
  if (env.HF_HUB_CACHE) return env.HF_HUB_CACHE;
  if (env.HF_HOME) return join(env.HF_HOME, "hub");
  return join(home, ".cache", "huggingface", "hub");
}

function isInside(parent: string, child: string): boolean {
  const fromParent = relative(parent, child);
  return (
    fromParent !== "" && !fromParent.startsWith("..") && !isAbsolute(fromParent)
  );
}

async function entries(directory: string): Promise<Dirent[]> {
  return readdir(directory, { withFileTypes: true }).catch(() => []);
}

/**
 * Lists the files under a snapshot folder. Hugging Face stores them as links
 * into the cache's blobs folder, so links are followed, but only to targets
 * inside the cache itself.
 */
async function snapshotFiles(
  cacheRoot: string,
  snapshot: string,
): Promise<{ path: string; size: number }[]> {
  const files: { path: string; size: number }[] = [];
  const walk = async (folder: string, depth: number) => {
    if (depth > MAX_DEPTH || files.length > MAX_ENTRIES) return;
    for (const entry of await entries(folder)) {
      const full = join(folder, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        const target = await realpath(full).catch(() => null);
        if (target === null || !isInside(cacheRoot, target)) continue;
        const info = await stat(target).catch(() => null);
        if (info?.isFile()) {
          files.push({
            path: relative(snapshot, full).split("\\").join("/"),
            size: info.size,
          });
        }
      }
    }
  };
  await walk(snapshot, 0);
  return files;
}

function dominantFormat(paths: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const path of paths) {
    const extension = extname(path).toLowerCase();
    if (MODEL_EXTENSIONS.has(extension)) {
      counts.set(extension, (counts.get(extension) ?? 0) + 1);
    }
  }
  const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return best ? best[0].slice(1) : "other";
}

/** Scans a Hugging Face hub cache. One result per cached snapshot. */
export async function scanHuggingFaceCache(
  cacheRoot: string,
  catalog: readonly CatalogEntry[],
): Promise<Found[]> {
  const root = await realpath(cacheRoot);
  const found: Found[] = [];
  for (const entry of await entries(root)) {
    // Only model repositories, stored as "models--<owner>--<name>".
    if (!entry.isDirectory() || !entry.name.startsWith("models--")) continue;
    const parts = entry.name.slice("models--".length).split("--");
    if (parts.length < 2) continue;
    const repoId = `${parts[0]}/${parts.slice(1).join("--")}`;
    const repoFolder = join(root, entry.name);

    for (const snapshot of await entries(join(repoFolder, "snapshots"))) {
      if (!snapshot.isDirectory()) continue;
      const snapshotPath = join(repoFolder, "snapshots", snapshot.name);
      const files = await snapshotFiles(root, snapshotPath);
      if (files.length === 0) continue;
      const present = new Map(files.map((file) => [file.path, file.size]));
      const match = catalog.find(
        (model) =>
          model.repoId === repoId &&
          model.revision === snapshot.name &&
          model.files.every(
            (file) => present.get(file.path) === file.sizeBytes,
          ),
      );
      found.push({
        path: snapshotPath,
        name: repoId,
        sizeBytes: files.reduce((total, file) => total + file.size, 0),
        format: dominantFormat(files.map((file) => file.path)),
        repoId,
        revision: snapshot.name,
        matchedModelId: match?.id ?? null,
      });
    }
  }
  return found;
}

/** Scans a user-chosen folder for model weight files. */
export async function scanModelFolder(
  folder: string,
  catalog: readonly CatalogEntry[],
): Promise<Found[]> {
  const root = await realpath(folder);
  const found: Found[] = [];
  let visited = 0;
  const walk = async (directory: string, depth: number) => {
    if (depth > MAX_DEPTH) return;
    for (const entry of await entries(directory)) {
      if ((visited += 1) > MAX_ENTRIES) return;
      if (entry.name.startsWith(".")) continue;
      const full = join(directory, entry.name);
      // Links are skipped entirely: they could lead anywhere on the disk.
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
        continue;
      }
      const extension = extname(entry.name).toLowerCase();
      if (!entry.isFile() || !MODEL_EXTENSIONS.has(extension)) continue;
      const info = await lstat(full).catch(() => null);
      if (!info || info.size < MIN_MODEL_BYTES) continue;
      const match = catalog.find((model) =>
        model.files.some(
          (file) =>
            file.path.split("/").pop() === entry.name &&
            file.sizeBytes === info.size,
        ),
      );
      found.push({
        path: full,
        name: entry.name,
        sizeBytes: info.size,
        format: extension.slice(1),
        repoId: null,
        revision: null,
        matchedModelId: match?.id ?? null,
      });
    }
  };
  await walk(root, 0);
  return found;
}

/** Reads the commit a cached repository's main branch points at, if any. */
export async function cachedMainRevision(
  cacheRoot: string,
  repoId: string,
): Promise<string | null> {
  const folder = join(
    cacheRoot,
    `models--${repoId.replace("/", "--")}`,
    "refs",
    "main",
  );
  const text = await readFile(folder, "utf8").catch(() => null);
  return text?.trim() || null;
}
