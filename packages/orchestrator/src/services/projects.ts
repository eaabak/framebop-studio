import { rm } from "node:fs/promises";
import type {
  Episode,
  EpisodeDetail,
  EpisodeSummary,
  Project,
  ProjectSummary,
  RpcParsedParams,
} from "@framebop/core";
import type { EngineContext } from "../context";
import { resolveMediaPath } from "../paths";
import type { JobQueue } from "./jobs";
import {
  definedOnly,
  removeUnreferencedAssets,
  requireEpisode,
  requireProject,
} from "./shared";

export function listProjects(ctx: EngineContext): ProjectSummary[] {
  return ctx.db.projects.list();
}

export function createProject(
  ctx: EngineContext,
  input: RpcParsedParams<"projects.create">,
): Project {
  const now = ctx.now();
  const project: Project = {
    id: ctx.newId(),
    ...input,
    createdAt: now,
    updatedAt: now,
  };
  ctx.db.projects.insert(project);
  ctx.log.scope("library").info("Created project", { projectId: project.id });
  return project;
}

export function updateProject(
  ctx: EngineContext,
  { id, patch }: RpcParsedParams<"projects.update">,
): Project {
  requireProject(ctx, id);
  ctx.db.projects.update(id, definedOnly(patch), ctx.now());
  return requireProject(ctx, id);
}

/**
 * Deletes a project, its episodes and scenes, and its folder of managed media.
 * Originals that were imported from elsewhere on disk are never touched.
 */
export async function deleteProject(
  ctx: EngineContext,
  jobs: JobQueue,
  id: string,
): Promise<void> {
  requireProject(ctx, id);
  // Stop work that would otherwise keep writing into the folder being removed.
  await jobs.cancelMatching((job) => job.projectId === id);
  ctx.db.projects.delete(id);
  // `id` passed schema validation as a UUID and is re-checked against the
  // media root here, so this recursive delete cannot leave the library.
  await rm(resolveMediaPath(ctx.paths.mediaRoot, id), {
    recursive: true,
    force: true,
  });
  ctx.log.scope("library").info("Deleted project", { projectId: id });
}

export function listEpisodes(
  ctx: EngineContext,
  projectId: string,
): EpisodeSummary[] {
  requireProject(ctx, projectId);
  return ctx.db.episodes.listSummaries(projectId);
}

export function getEpisodeDetail(
  ctx: EngineContext,
  id: string,
): EpisodeDetail {
  return {
    episode: requireEpisode(ctx, id),
    scenes: ctx.db.scenes.listForEpisode(id),
    assets: ctx.db.assets.listForEpisode(id),
  };
}

export function createEpisode(
  ctx: EngineContext,
  { projectId, title }: RpcParsedParams<"episodes.create">,
): Episode {
  requireProject(ctx, projectId);
  const now = ctx.now();
  return ctx.db.transaction(() => {
    const episode: Episode = {
      id: ctx.newId(),
      projectId,
      sequenceIndex: ctx.db.episodes.nextSequenceIndex(projectId),
      title,
      script: "",
      productionState: "draft",
      musicAssetId: null,
      musicVolume: 0.15,
      createdAt: now,
      updatedAt: now,
    };
    ctx.db.episodes.insert(episode);
    ctx.db.projects.touch(projectId, now);
    return episode;
  });
}

export function updateEpisode(
  ctx: EngineContext,
  { id, patch }: RpcParsedParams<"episodes.update">,
): Episode {
  const episode = requireEpisode(ctx, id);
  const now = ctx.now();
  ctx.db.transaction(() => {
    ctx.db.episodes.update(id, definedOnly(patch), now);
    ctx.db.projects.touch(episode.projectId, now);
  });
  return requireEpisode(ctx, id);
}

export async function deleteEpisode(
  ctx: EngineContext,
  jobs: JobQueue,
  id: string,
): Promise<void> {
  const episode = requireEpisode(ctx, id);
  await jobs.cancelMatching((job) => job.episodeId === id);
  ctx.db.transaction(() => {
    ctx.db.episodes.delete(id);
    ctx.db.projects.touch(episode.projectId, ctx.now());
  });
  await removeUnreferencedAssets(ctx, episode.projectId);
}
