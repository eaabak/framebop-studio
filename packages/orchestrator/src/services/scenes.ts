import {
  AppError,
  type RpcParsedParams,
  type Scene,
  type ScenePatch,
  type SceneSlot,
  splitScriptIntoScenes,
} from "@framebop/core";
import type { EngineContext } from "../context";
import type { JobQueue } from "./jobs";
import { getSettings } from "./settings";
import {
  definedOnly,
  removeUnreferencedAssets,
  requireEpisode,
  requireScene,
} from "./shared";

function blankScene(
  ctx: EngineContext,
  episodeId: string,
  durationSeconds: number,
  now: string,
): Scene {
  return {
    id: ctx.newId(),
    episodeId,
    sequenceIndex: 0,
    title: "",
    description: "",
    durationSeconds,
    narrationText: "",
    imagePrompt: "",
    motionPrompt: "",
    cameraMotion: "static",
    cameraInstructions: "",
    animationEngine: null,
    transition: "cut",
    overlayText: "",
    overlayPosition: "bottom",
    imageAssetId: null,
    videoAssetId: null,
    audioAssetId: null,
    generationState: "idle",
    createdAt: now,
    updatedAt: now,
  };
}

/** Inserts `scene` at `index` and renumbers the episode so indices stay dense. */
function insertAt(ctx: EngineContext, scene: Scene, index: number): void {
  const order = ctx.db.scenes.listForEpisode(scene.episodeId).map((s) => s.id);
  ctx.db.scenes.insert({ ...scene, sequenceIndex: index });
  order.splice(index, 0, scene.id);
  ctx.db.scenes.applyOrder(order);
}

export function createScene(
  ctx: EngineContext,
  { episodeId, afterSceneId, fields }: RpcParsedParams<"scenes.create">,
): Scene {
  const episode = requireEpisode(ctx, episodeId);
  const { defaultSceneDurationSeconds } = getSettings(ctx);
  const now = ctx.now();

  const id = ctx.db.transaction(() => {
    const existing = ctx.db.scenes.listForEpisode(episodeId);
    let index = existing.length;
    if (afterSceneId !== undefined) {
      const anchor = existing.findIndex((scene) => scene.id === afterSceneId);
      if (anchor === -1) {
        throw new AppError(
          "NOT_FOUND",
          "The scene to insert after no longer exists.",
        );
      }
      index = anchor + 1;
    }
    const scene: Scene = {
      ...blankScene(ctx, episodeId, defaultSceneDurationSeconds, now),
      ...definedOnly(fields ?? {}),
    };
    insertAt(ctx, scene, index);
    ctx.db.projects.touch(episode.projectId, now);
    return scene.id;
  });
  return requireScene(ctx, id);
}

export function updateScene(
  ctx: EngineContext,
  id: string,
  patch: ScenePatch,
): Scene {
  const scene = requireScene(ctx, id);
  const episode = requireEpisode(ctx, scene.episodeId);
  const now = ctx.now();
  ctx.db.transaction(() => {
    ctx.db.scenes.update(id, definedOnly(patch), now);
    ctx.db.projects.touch(episode.projectId, now);
  });
  return requireScene(ctx, id);
}

/** Copies a scene, sharing its media, and places the copy right after it. */
export function duplicateScene(ctx: EngineContext, id: string): Scene {
  const source = requireScene(ctx, id);
  const episode = requireEpisode(ctx, source.episodeId);
  const now = ctx.now();
  const copyId = ctx.db.transaction(() => {
    const copy: Scene = {
      ...source,
      id: ctx.newId(),
      title: source.title ? `${source.title} copy`.slice(0, 160) : "",
      generationState: "idle",
      createdAt: now,
      updatedAt: now,
    };
    insertAt(ctx, copy, source.sequenceIndex + 1);
    ctx.db.projects.touch(episode.projectId, now);
    return copy.id;
  });
  return requireScene(ctx, copyId);
}

export async function deleteScene(
  ctx: EngineContext,
  jobs: JobQueue,
  id: string,
): Promise<void> {
  const scene = requireScene(ctx, id);
  const episode = requireEpisode(ctx, scene.episodeId);
  await jobs.cancelMatching((job) => job.sceneId === id);
  ctx.db.transaction(() => {
    ctx.db.scenes.delete(id);
    ctx.db.scenes.applyOrder(
      ctx.db.scenes.listForEpisode(scene.episodeId).map((s) => s.id),
    );
    ctx.db.projects.touch(episode.projectId, ctx.now());
  });
  await removeUnreferencedAssets(ctx, episode.projectId);
}

export function reorderScenes(
  ctx: EngineContext,
  { episodeId, orderedSceneIds }: RpcParsedParams<"scenes.reorder">,
): Scene[] {
  const episode = requireEpisode(ctx, episodeId);
  return ctx.db.transaction(() => {
    const current = new Set(
      ctx.db.scenes.listForEpisode(episodeId).map((scene) => scene.id),
    );
    const requested = new Set(orderedSceneIds);
    const isPermutation =
      requested.size === orderedSceneIds.length &&
      requested.size === current.size &&
      orderedSceneIds.every((id) => current.has(id));
    if (!isPermutation) {
      // The caller's view of the episode is stale; applying it would drop or
      // duplicate scenes.
      throw new AppError(
        "CONFLICT",
        "The scene list changed before the new order could be saved. Reload the episode and try again.",
      );
    }
    ctx.db.scenes.applyOrder(orderedSceneIds);
    ctx.db.projects.touch(episode.projectId, ctx.now());
    return ctx.db.scenes.listForEpisode(episodeId);
  });
}

/**
 * Builds scenes from the episode script, one per paragraph. Purely textual:
 * no model is involved and the result is fully determined by the script.
 */
export async function createScenesFromScript(
  ctx: EngineContext,
  jobs: JobQueue,
  { episodeId, mode }: RpcParsedParams<"scenes.createFromScript">,
): Promise<Scene[]> {
  const episode = requireEpisode(ctx, episodeId);
  const { narrationWordsPerMinute } = getSettings(ctx);
  const drafts = splitScriptIntoScenes(episode.script, {
    wordsPerMinute: narrationWordsPerMinute,
  });
  if (drafts.length === 0) {
    throw new AppError(
      "VALIDATION",
      "The script is empty, so there is nothing to split into scenes.",
    );
  }
  if (mode === "replace") {
    await jobs.cancelMatching((job) => job.episodeId === episodeId);
  }

  const now = ctx.now();
  ctx.db.transaction(() => {
    if (mode === "replace") ctx.db.scenes.deleteForEpisode(episodeId);
    const offset = ctx.db.scenes.listForEpisode(episodeId).length;
    drafts.forEach((draft, index) => {
      ctx.db.scenes.insert({
        ...blankScene(ctx, episodeId, draft.durationSeconds, now),
        sequenceIndex: offset + index,
        title: draft.title,
        narrationText: draft.narrationText,
      });
    });
    ctx.db.projects.touch(episode.projectId, now);
  });
  if (mode === "replace")
    await removeUnreferencedAssets(ctx, episode.projectId);
  return ctx.db.scenes.listForEpisode(episodeId);
}

export async function clearSceneSlot(
  ctx: EngineContext,
  sceneId: string,
  slot: SceneSlot,
): Promise<Scene> {
  const scene = requireScene(ctx, sceneId);
  const episode = requireEpisode(ctx, scene.episodeId);
  ctx.db.scenes.setSlot(sceneId, slot, null, ctx.now());
  await removeUnreferencedAssets(ctx, episode.projectId);
  return requireScene(ctx, sceneId);
}
