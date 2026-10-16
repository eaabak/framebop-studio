import { rm } from "node:fs/promises";
import {
  AppError,
  type Asset,
  type Episode,
  type Project,
  type Scene,
} from "@framebop/core";
import type { EngineContext } from "../context";
import { resolveMediaPath } from "../paths";

export function requireProject(ctx: EngineContext, id: string): Project {
  const project = ctx.db.projects.get(id);
  if (!project)
    throw new AppError("NOT_FOUND", "That project no longer exists.");
  return project;
}

export function requireEpisode(ctx: EngineContext, id: string): Episode {
  const episode = ctx.db.episodes.get(id);
  if (!episode)
    throw new AppError("NOT_FOUND", "That episode no longer exists.");
  return episode;
}

export function requireScene(ctx: EngineContext, id: string): Scene {
  const scene = ctx.db.scenes.get(id);
  if (!scene) throw new AppError("NOT_FOUND", "That scene no longer exists.");
  return scene;
}

/** Drops keys whose value is undefined, so a patch never overwrites with it. */
export function definedOnly<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

/** Removes an asset's files from the library. Missing files are not an error. */
export async function removeAssetFiles(
  ctx: EngineContext,
  asset: Pick<Asset, "relativePath" | "thumbnailPath">,
): Promise<void> {
  for (const relativePath of [asset.relativePath, asset.thumbnailPath]) {
    if (relativePath === null) continue;
    try {
      await rm(resolveMediaPath(ctx.paths.mediaRoot, relativePath), {
        force: true,
      });
    } catch (error) {
      ctx.log.scope("library").warn("Could not remove a media file", {
        relativePath,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Deletes managed copies that no scene references any more.
 *
 * Imported media is copied into the library, so removing these files never
 * touches the user's originals. Called after any operation that can orphan
 * an asset: clearing or replacing a slot, deleting a scene or an episode.
 */
export async function removeUnreferencedAssets(
  ctx: EngineContext,
  projectId: string,
): Promise<number> {
  const orphans = ctx.db.assets.listUnreferenced(projectId);
  for (const asset of orphans) {
    ctx.db.assets.delete(asset.id);
    await removeAssetFiles(ctx, asset);
  }
  if (orphans.length > 0) {
    ctx.log.scope("library").info("Removed unreferenced media", {
      projectId,
      count: orphans.length,
    });
  }
  return orphans.length;
}
