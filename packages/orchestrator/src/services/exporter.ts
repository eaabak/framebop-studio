import { stat, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute } from "node:path";
import { AppError, type Asset, type RpcResult } from "@framebop/core";
import type { EngineContext } from "../context";
import { getEpisodeDetail } from "./projects";
import { requireProject } from "./shared";
import { APP_VERSION } from "./system";

function describeAsset(asset: Asset | undefined) {
  if (!asset) return null;
  return {
    id: asset.id,
    kind: asset.kind,
    origin: asset.origin,
    relativePath: asset.relativePath,
    originalFilename: asset.originalFilename,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    sha256: asset.sha256,
    width: asset.width,
    height: asset.height,
    durationSeconds: asset.durationSeconds,
  };
}

/**
 * Writes a JSON description of an episode: its scenes in order, their text,
 * and the media each one references. It is a plain data export for backup,
 * inspection and interchange. It is not a rendered video.
 */
export async function exportEpisodeManifest(
  ctx: EngineContext,
  episodeId: string,
  targetPath: string,
): Promise<RpcResult<"export.episodeManifest">> {
  if (
    !isAbsolute(targetPath) ||
    extname(targetPath).toLowerCase() !== ".json"
  ) {
    throw new AppError(
      "VALIDATION",
      "Choose a destination file ending in .json.",
    );
  }
  const parent = await stat(dirname(targetPath)).catch(() => null);
  if (!parent?.isDirectory()) {
    throw new AppError("VALIDATION", "The destination folder does not exist.");
  }

  const { episode, scenes, assets } = getEpisodeDetail(ctx, episodeId);
  const project = requireProject(ctx, episode.projectId);
  const byId = new Map(assets.map((asset) => [asset.id, asset]));

  const manifest = {
    format: "framebop.episode-manifest",
    formatVersion: 1,
    exportedAt: ctx.now(),
    generator: { name: "Framebop Studio", version: APP_VERSION },
    /** `relativePath` values below are relative to this directory. */
    mediaRoot: ctx.paths.mediaRoot,
    project,
    episode,
    totalDurationSeconds: scenes.reduce(
      (sum, scene) => sum + scene.durationSeconds,
      0,
    ),
    scenes: scenes.map((scene) => ({
      index: scene.sequenceIndex,
      id: scene.id,
      title: scene.title,
      description: scene.description,
      durationSeconds: scene.durationSeconds,
      narrationText: scene.narrationText,
      imagePrompt: scene.imagePrompt,
      motionPrompt: scene.motionPrompt,
      cameraMotion: scene.cameraMotion,
      cameraInstructions: scene.cameraInstructions,
      animationEngine: scene.animationEngine,
      image: describeAsset(byId.get(scene.imageAssetId ?? "")),
      video: describeAsset(byId.get(scene.videoAssetId ?? "")),
      audio: describeAsset(byId.get(scene.audioAssetId ?? "")),
    })),
  };

  const body = `${JSON.stringify(manifest, null, 2)}\n`;
  try {
    await writeFile(targetPath, body, "utf8");
  } catch (error) {
    throw new AppError(
      "IO",
      `Could not write the manifest: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  ctx.log
    .scope("export")
    .info("Exported episode manifest", { episodeId, targetPath });
  return { path: targetPath, sizeBytes: Buffer.byteLength(body) };
}
