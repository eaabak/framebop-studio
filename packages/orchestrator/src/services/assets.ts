import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  copyFile,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  AppError,
  type Asset,
  type AssetKind,
  type Episode,
  IdSchema,
  type Job,
  MEDIA_FORMATS,
  type RpcParsedParams,
  SceneSlotSchema,
  extensionOf,
  extensionsFor,
  mediaFormatFor,
} from "@framebop/core";
import { readWavInfo } from "@framebop/ai-adapters";
import { z } from "zod";
import type { EngineContext } from "../context";
import {
  assertContentMatchesExtension,
  createThumbnail,
  probeMedia,
} from "../media/inspect";
import { resolveMediaPath } from "../paths";
import type { JobControl, JobExecutor, JobQueue, JobResult } from "./jobs";
import {
  removeAssetFiles,
  removeUnreferencedAssets,
  requireEpisode,
  requireScene,
} from "./shared";

const SceneImportSchema = z.object({
  sceneId: IdSchema,
  slot: SceneSlotSchema,
  sourcePath: z.string(),
});
/** Background music is attached to an episode instead of a scene. */
const MusicImportSchema = z.object({
  target: z.literal("music"),
  episodeId: IdSchema,
  sourcePath: z.string(),
});
const ImportInputSchema = z.union([MusicImportSchema, SceneImportSchema]);

export const SLOT_FIELD = {
  image: "imageAssetId",
  video: "videoAssetId",
  audio: "audioAssetId",
} as const;

/**
 * Validates an import request and queues it. Problems that can be detected
 * from the request alone are reported immediately; anything that depends on
 * the file itself is reported through the job, where it can be retried.
 */
export function startImport(
  ctx: EngineContext,
  queue: JobQueue,
  params: RpcParsedParams<"assets.import">,
): Job {
  const scene = requireScene(ctx, params.sceneId);
  const episode = requireEpisode(ctx, scene.episodeId);
  const filename = basename(params.sourcePath);

  if (!isAbsolute(params.sourcePath)) {
    throw new AppError("VALIDATION", "Media must be chosen by its full path.");
  }
  const format = mediaFormatFor(filename);
  if (format === null) {
    const supported = Object.keys(MEDIA_FORMATS).join(", ");
    throw new AppError(
      "VALIDATION",
      `"${filename}" is not a supported media type. Supported types: ${supported}.`,
    );
  }
  if (format.kind !== params.slot) {
    throw new AppError(
      "VALIDATION",
      `"${filename}" is ${format.kind}, but this slot takes ${params.slot} files (${extensionsFor(params.slot).join(", ")}).`,
    );
  }

  return queue.submit({
    type: "media_import",
    label: `Import ${filename}`,
    adapterId: null,
    model: null,
    projectId: episode.projectId,
    episodeId: episode.id,
    sceneId: scene.id,
    slot: params.slot,
    input: { ...params },
  });
}

/** Copies `source` to `destination`, hashing it and reporting bytes written. */
/** Queues the import of an episode's background music. */
export function startMusicImport(
  ctx: EngineContext,
  queue: JobQueue,
  params: RpcParsedParams<"episodes.importMusic">,
): Job {
  const episode = requireEpisode(ctx, params.episodeId);
  const filename = basename(params.sourcePath);
  if (!isAbsolute(params.sourcePath)) {
    throw new AppError("VALIDATION", "Media must be chosen by its full path.");
  }
  if (mediaFormatFor(filename)?.kind !== "audio") {
    throw new AppError(
      "VALIDATION",
      `"${filename}" is not an audio file. Music can be ${extensionsFor("audio").join(", ")}.`,
    );
  }
  return queue.submit({
    type: "media_import",
    label: `Import music ${filename}`,
    adapterId: null,
    model: null,
    projectId: episode.projectId,
    episodeId: episode.id,
    sceneId: null,
    slot: "audio",
    input: { target: "music", ...params },
  });
}

/** Takes the background music off an episode. */
export async function removeMusic(
  ctx: EngineContext,
  episodeId: string,
): Promise<Episode> {
  const episode = requireEpisode(ctx, episodeId);
  const now = ctx.now();
  ctx.db.transaction(() => {
    ctx.db.episodes.update(episodeId, { musicAssetId: null }, now);
    ctx.db.projects.touch(episode.projectId, now);
  });
  await removeUnreferencedAssets(ctx, episode.projectId);
  const updated = requireEpisode(ctx, episodeId);
  ctx.emit({ type: "episode.updated", episode: updated, assets: [] });
  return updated;
}

/** The exact length of a WAV file, from its header, or null. */
async function wavDuration(path: string): Promise<number | null> {
  const handle = await open(path, "r").catch(() => null);
  if (!handle) return null;
  try {
    const { size } = await handle.stat();
    const header = Buffer.alloc(Math.min(size, 64 * 1024));
    await handle.read(header, 0, header.length, 0);
    const info = readWavInfo(header, size);
    return info.durationSeconds > 0 ? info.durationSeconds : null;
  } catch {
    return null;
  } finally {
    await handle.close();
  }
}

async function copyWithHash(
  source: string,
  destination: string,
  totalBytes: number,
  control: JobControl,
): Promise<string> {
  const hash = createHash("sha256");
  let copied = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      copied += chunk.length;
      control.reportProgress(copied / totalBytes, "Copying");
      callback(null, chunk);
    },
  });
  await pipeline(
    createReadStream(source),
    meter,
    // "wx" fails instead of overwriting, so a name collision can never
    // silently replace an existing library file.
    createWriteStream(destination, { flags: "wx" }),
    { signal: control.signal },
  );
  return hash.digest("hex");
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

async function describeSource(sourcePath: string) {
  let resolved: string;
  try {
    resolved = await realpath(sourcePath);
  } catch {
    throw new AppError(
      "NOT_FOUND",
      `The file could not be found: ${sourcePath}. If it is on an external drive, reconnect it and retry.`,
    );
  }
  const info = await stat(resolved);
  if (!info.isFile()) {
    throw new AppError("VALIDATION", "Only regular files can be imported.");
  }
  if (info.size === 0) throw new AppError("VALIDATION", "The file is empty.");
  return { resolved, sizeBytes: info.size };
}

/** Moves a file, falling back to copy and delete across volumes. */
async function moveFile(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    await copyFile(from, to);
    await rm(from, { force: true });
  }
}

interface IncomingFile {
  projectId: string;
  kind: AssetKind;
  origin: Asset["origin"];
  mimeType: string;
  extension: string;
  originalFilename: string;
  sizeBytes: number;
  sha256: string;
}

/**
 * Gives a complete file its place in the library.
 *
 * If the project already holds identical content of the same kind, the file
 * is discarded and the existing asset is returned. Otherwise it is moved to
 * its final name, measured, and described as a new asset. The new asset is
 * not written to the database here: the caller does that in the same
 * transaction that first references it, so it is never briefly an orphan.
 */
async function placeInLibrary(
  ctx: EngineContext,
  file: IncomingFile,
  currentPath: string,
): Promise<{ asset: Asset; reused: boolean }> {
  const existing = ctx.db.assets.findByHash(file.projectId, file.sha256);
  if (existing !== null && existing.kind === file.kind) {
    await rm(currentPath, { force: true });
    return { asset: existing, reused: true };
  }

  const id = ctx.newId();
  const relativePath = `${file.projectId}/${id}.${file.extension}`;
  const destination = resolveMediaPath(ctx.paths.mediaRoot, relativePath);
  await mkdir(dirname(destination), { recursive: true });
  await moveFile(currentPath, destination);

  const { ffmpeg, ffprobe } = ctx.tools;
  const metadata =
    ffprobe.available && ffprobe.path
      ? await probeMedia(ffprobe.path, destination, file.kind)
      : { width: null, height: null, durationSeconds: null };
  // A WAV file states its own length exactly, so it is measured even
  // without FFmpeg. Narration needs a known length to be placed in a render.
  if (
    file.kind === "audio" &&
    metadata.durationSeconds === null &&
    file.extension === "wav"
  ) {
    metadata.durationSeconds = await wavDuration(destination);
  }

  let thumbnailPath: string | null = null;
  if (file.kind !== "audio" && ffmpeg.available && ffmpeg.path) {
    const candidate = `${file.projectId}/thumbs/${id}.jpg`;
    const thumbnailFile = resolveMediaPath(ctx.paths.mediaRoot, candidate);
    await mkdir(dirname(thumbnailFile), { recursive: true });
    // Skip the first frames of a clip, which are often black or a fade-in.
    const seek =
      file.kind === "video"
        ? Math.min(1, (metadata.durationSeconds ?? 0) / 4)
        : 0;
    if (await createThumbnail(ffmpeg.path, destination, thumbnailFile, seek)) {
      thumbnailPath = candidate;
    } else {
      ctx.log.scope("library").warn("Could not create a thumbnail", {
        file: file.originalFilename,
      });
    }
  }

  return {
    reused: false,
    asset: {
      id,
      projectId: file.projectId,
      kind: file.kind,
      origin: file.origin,
      relativePath,
      thumbnailPath,
      originalFilename: file.originalFilename,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
      ...metadata,
      createdAt: ctx.now(),
    },
  };
}

/**
 * Brings a media file into the library and attaches it to a scene slot.
 *
 * The file is copied, never moved or linked, so a scene keeps working after
 * the original is renamed, moved or deleted. The copy is written under a
 * temporary name and renamed into place only once complete, so a crash never
 * leaves a truncated file that looks valid.
 */
export function createImportExecutor(ctx: EngineContext): JobExecutor {
  async function run(job: Job, control: JobControl): Promise<JobResult> {
    const parsed = ImportInputSchema.parse(job.input);
    const music = "target" in parsed;
    const { sourcePath } = parsed;
    const slot = music ? "audio" : parsed.slot;
    const sceneId = music ? null : parsed.sceneId;
    const episodeId = music
      ? parsed.episodeId
      : requireScene(ctx, parsed.sceneId).episodeId;
    const { projectId } = requireEpisode(ctx, episodeId);

    const extension = extensionOf(sourcePath);
    const format = mediaFormatFor(sourcePath);
    if (format === null || format.kind !== slot) {
      throw new AppError("VALIDATION", "Unsupported media type for this slot.");
    }
    const source = await describeSource(sourcePath);
    await assertContentMatchesExtension(source.resolved, extension);

    const partial = resolveMediaPath(
      ctx.paths.mediaRoot,
      `${projectId}/${ctx.newId()}.${extension}.partial`,
    );
    await mkdir(dirname(partial), { recursive: true });
    let sha256: string;
    try {
      sha256 = await copyWithHash(
        source.resolved,
        partial,
        source.sizeBytes,
        control,
      );
    } catch (error) {
      await rm(partial, { force: true });
      throw error;
    }
    // Copying is the only measurable step; analysis below is not.
    control.reportProgress(null, "Analysing");

    const { asset, reused } = await placeInLibrary(
      ctx,
      {
        projectId,
        kind: format.kind,
        origin: "imported",
        mimeType: format.mimeType,
        extension,
        originalFilename: basename(sourcePath),
        sizeBytes: source.sizeBytes,
        sha256,
      },
      partial,
    );

    const now = ctx.now();
    const stillThere = ctx.db.transaction(() => {
      if (sceneId === null) {
        if (ctx.db.episodes.get(episodeId) === null) return false;
        if (!reused) ctx.db.assets.insert(asset);
        ctx.db.episodes.update(episodeId, { musicAssetId: asset.id }, now);
      } else {
        if (ctx.db.scenes.get(sceneId) === null) return false;
        if (!reused) ctx.db.assets.insert(asset);
        ctx.db.scenes.setSlot(sceneId, slot, asset.id, now);
      }
      ctx.db.projects.touch(projectId, now);
      return true;
    });
    if (!stillThere) {
      if (!reused) await removeAssetFiles(ctx, asset);
      throw new AppError(
        "NOT_FOUND",
        sceneId === null
          ? "The episode was deleted while its music was importing."
          : "The scene was deleted while its media was importing.",
      );
    }

    // The previous file in that place may now be unused.
    await removeUnreferencedAssets(ctx, projectId);
    if (sceneId === null) {
      ctx.emit({
        type: "episode.updated",
        episode: requireEpisode(ctx, episodeId),
        assets: [asset],
      });
    } else {
      ctx.emit({
        type: "scene.updated",
        scene: requireScene(ctx, sceneId),
        assets: [asset],
      });
    }
    return {
      output: {
        assetId: asset.id,
        relativePath: asset.relativePath,
        field: sceneId === null ? "musicAssetId" : SLOT_FIELD[slot],
        deduplicated: reused,
      },
    };
  }

  return { canCancel: () => true, run };
}

/**
 * Takes a file an engine wrote into its working folder and makes it a
 * library asset with origin "generated". The file is moved, not copied: the
 * working folder is temporary and nothing else refers to it.
 */
export async function adoptGeneratedFile(
  ctx: EngineContext,
  file: {
    projectId: string;
    filePath: string;
    kind: AssetKind;
    mimeType: string;
    extension: string;
    originalFilename: string;
  },
): Promise<{ asset: Asset; reused: boolean }> {
  const info = await stat(file.filePath);
  return placeInLibrary(
    ctx,
    {
      projectId: file.projectId,
      kind: file.kind,
      origin: "generated",
      mimeType: file.mimeType,
      extension: file.extension,
      originalFilename: file.originalFilename,
      sizeBytes: info.size,
      sha256: await hashFile(file.filePath),
    },
    file.filePath,
  );
}

/**
 * Copies a PNG into a project's library without attaching it to a scene,
 * for pictures an animation uses. An identical file already there is reused.
 */
export async function importReferencePicture(
  ctx: EngineContext,
  projectId: string,
  sourcePath: string,
): Promise<Asset> {
  if (!isAbsolute(sourcePath))
    throw new AppError("VALIDATION", "Choose a picture by its full path.");
  const format = mediaFormatFor(sourcePath);
  if (!format || format.kind !== "image")
    throw new AppError(
      "VALIDATION",
      "Choose a supported PNG, JPEG or WebP picture.",
    );
  const source = await describeSource(sourcePath);
  if (source.sizeBytes > 25 * 1024 * 1024)
    throw new AppError(
      "VALIDATION",
      "Reference pictures must be at most 25 MiB.",
    );
  const extension = extensionOf(sourcePath);
  await assertContentMatchesExtension(source.resolved, extension);
  return importLibraryFile(ctx, projectId, source.resolved, {
    kind: "image",
    mimeType: format.mimeType,
    extension,
  });
}

export async function importLibraryPicture(
  ctx: EngineContext,
  projectId: string,
  sourcePath: string,
): Promise<Asset> {
  return importLibraryFile(ctx, projectId, sourcePath, {
    kind: "image",
    mimeType: "image/png",
    extension: "png",
  });
}

/**
 * Stores a WAV made by the engine, such as a Lab experiment's sound, in a
 * project's library without attaching it to a scene.
 */
export async function importLibrarySound(
  ctx: EngineContext,
  projectId: string,
  name: string,
  wav: Uint8Array,
): Promise<Asset> {
  const source = resolveMediaPath(
    ctx.paths.mediaRoot,
    `${projectId}/${ctx.newId()}.source.partial`,
  );
  await mkdir(dirname(source), { recursive: true });
  await writeFile(source, wav);
  try {
    return await importLibraryFile(
      ctx,
      projectId,
      source,
      { kind: "audio", mimeType: "audio/wav", extension: "wav" },
      name,
    );
  } finally {
    await rm(source, { force: true });
  }
}

async function importLibraryFile(
  ctx: EngineContext,
  projectId: string,
  sourcePath: string,
  type: { kind: Asset["kind"]; mimeType: string; extension: string },
  originalFilename = basename(sourcePath),
): Promise<Asset> {
  const temporary = resolveMediaPath(
    ctx.paths.mediaRoot,
    `${projectId}/${ctx.newId()}.partial`,
  );
  await mkdir(dirname(temporary), { recursive: true });
  await copyFile(sourcePath, temporary);
  try {
    const { asset, reused } = await placeInLibrary(
      ctx,
      {
        projectId,
        ...type,
        origin: "imported",
        originalFilename,
        sizeBytes: (await stat(temporary)).size,
        sha256: await hashFile(temporary),
      },
      temporary,
    );
    if (!reused) ctx.db.assets.insert(asset);
    return asset;
  } finally {
    await rm(temporary, { force: true });
  }
}

/**
 * Stores media details measured by the interface while displaying a file.
 *
 * FFmpeg is optional, so an asset may have been imported without dimensions
 * or duration. The webview learns them as soon as it shows the file. Only
 * empty fields are filled: a value measured by ffprobe always wins, and a
 * still image never gains a duration.
 */
export function recordMeasuredMetadata(
  ctx: EngineContext,
  {
    assetId,
    width,
    height,
    durationSeconds,
  }: RpcParsedParams<"assets.reportMetadata">,
): Asset {
  const asset = ctx.db.assets.get(assetId);
  if (!asset) throw new AppError("NOT_FOUND", "That asset no longer exists.");

  const measured = {
    width: asset.kind === "audio" ? null : width,
    height: asset.kind === "audio" ? null : height,
    durationSeconds: asset.kind === "image" ? null : durationSeconds,
  };
  const fills =
    (asset.width === null && measured.width !== null) ||
    (asset.height === null && measured.height !== null) ||
    (asset.durationSeconds === null && measured.durationSeconds !== null);
  if (!fills) return asset;

  ctx.db.assets.fillMissingMetadata(assetId, measured);
  ctx.log
    .scope("library")
    .info("Stored media details measured by the interface", {
      assetId,
      kind: asset.kind,
    });
  return ctx.db.assets.get(assetId) ?? asset;
}

/** Removes copies left unfinished by a crash or forced quit. Runs at startup. */
export async function removePartialFiles(ctx: EngineContext): Promise<void> {
  let removed = 0;
  const projectDirectories = await readdir(ctx.paths.mediaRoot, {
    withFileTypes: true,
  });
  for (const directory of projectDirectories) {
    if (!directory.isDirectory()) continue;
    const projectPath = join(ctx.paths.mediaRoot, directory.name);
    for (const file of await readdir(projectPath)) {
      if (!file.endsWith(".partial")) continue;
      await rm(join(projectPath, file), { force: true });
      removed += 1;
    }
  }
  if (removed > 0) {
    ctx.log
      .scope("import")
      .info("Removed unfinished copies from a previous run", { removed });
  }
}
