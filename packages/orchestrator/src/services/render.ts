/**
 * Rendering an episode to an MP4 file.
 *
 * The episode is turned into a render plan (`@framebop/renderer`), its media
 * files are checked, and a `video_render` job is queued. The job runs in the
 * production lane, one at a time, and hands the plan to the render adapter,
 * which works in a separate process. The file it writes is checked with
 * FFmpeg before anything reports success; only then is it moved to the export
 * folder and recorded.
 *
 * Exported files belong to the user. Framebop never deletes them: forgetting
 * a render removes its record, not the file.
 */
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  realpath,
  rename,
  rm,
  stat,
  unlink,
} from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
  AdapterError,
  type AdapterRegistry,
  type ExecutionContext,
  REMOTION_ID,
  type VideoRenderAdapter,
} from "@framebop/ai-adapters";
import {
  type AnimationSpec,
  AppError,
  type Asset,
  IdSchema,
  type Job,
  type AnimationPreview,
  NARRATION_LEAD_SECONDS,
  NARRATION_TAIL_SECONDS,
  type OutputValidation,
  type PlanNotice,
  RENDER_RESOLUTIONS,
  type RenderPlan,
  RenderPlanSchema,
  type RenderPreview,
  type RenderRecord,
  type RenderSettings,
  type SceneShot,
  extensionOf,
} from "@framebop/core";
import {
  buildRenderPlan,
  framesOf,
  framesToContain,
  planIdentity,
  samplesFromPcm16,
  speechEnvelope,
} from "@framebop/renderer";
import { z } from "zod";
import type { EngineContext } from "../context";
import { assertContentMatchesExtension } from "../media/inspect";
import { validateRenderOutput } from "../media/validate";
import { resolveMediaPath } from "../paths";
import type { JobControl, JobExecutor, JobQueue, JobResult } from "./jobs";
import { getSettings } from "./settings";
import { requireEpisode } from "./shared";

const RenderInputSchema = z.object({
  episodeId: IdSchema,
  title: z.string(),
  plan: RenderPlanSchema,
  planHash: z.string(),
  outputDirectory: z.string(),
  /** Files the plan uses, with the size they had when it was made. */
  files: z.array(
    z.object({ path: z.string(), sizeBytes: z.number(), label: z.string() }),
  ),
});
type RenderInput = z.infer<typeof RenderInputSchema>;

export function renderSettingsOf(ctx: EngineContext): RenderSettings {
  const settings = getSettings(ctx);
  const { width, height } = RENDER_RESOLUTIONS[settings.exportResolution];
  return {
    width,
    height,
    fps: settings.exportFps,
    captions: settings.exportCaptions,
  };
}

/** Where finished videos go: the chosen folder, or "exports" in the library. */
export function exportDirectoryOf(ctx: EngineContext): string {
  return getSettings(ctx).exportDirectory ?? join(ctx.paths.dataDir, "exports");
}

/** Mouth movement measured from narration files, by content and frame rate. */
const envelopes = new Map<string, number[]>();

/** Decodes a narration to mono PCM with FFmpeg and measures its loudness. */
async function narrationEnvelope(
  ffmpeg: string,
  file: string,
  sha256: string,
  fps: number,
): Promise<number[] | null> {
  const key = `${sha256}:${fps}`;
  const cached = envelopes.get(key);
  if (cached) return cached;
  const rate = 8000;
  const pcm = await new Promise<Buffer | null>((resolve) => {
    execFile(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        file,
        "-ac",
        "1",
        "-ar",
        String(rate),
        "-f",
        "s16le",
        "pipe:1",
      ],
      {
        encoding: "buffer",
        maxBuffer: 128 * 1024 * 1024,
        timeout: 60_000,
        windowsHide: true,
      },
      (error, stdout) => resolve(error ? null : stdout),
    );
  });
  if (!pcm) return null;
  const envelope = speechEnvelope(samplesFromPcm16(pcm), rate, fps);
  if (envelopes.size > 64) envelopes.clear();
  envelopes.set(key, envelope);
  return envelope;
}

async function planEpisode(ctx: EngineContext, episodeId: string) {
  const episode = requireEpisode(ctx, episodeId);
  const scenes = ctx.db.scenes.listForEpisode(episodeId);
  const ids = new Set<string>();
  for (const scene of scenes) {
    for (const id of [
      scene.imageAssetId,
      scene.videoAssetId,
      scene.audioAssetId,
    ]) {
      if (id) ids.add(id);
    }
  }
  if (episode.musicAssetId) ids.add(episode.musicAssetId);
  // Pictures (and a Lab experiment's sound) of scenes drawn as 2D
  // animation, and the shots of the others.
  const plans = ctx.db.plans.forEpisode(episodeId);
  for (const plan of plans.values()) {
    for (const shot of plan.shots) ids.add(shot.assetId);
    if (plan.method !== "layered-2d" || !plan.animation) continue;
    for (const image of Object.values(plan.animation.images)) {
      if (image.assetId) ids.add(image.assetId);
    }
    const sound = plan.animation.lab?.soundAssetId;
    if (sound) ids.add(sound);
  }
  const assets = new Map(
    [...ids]
      .map((id) => ctx.db.assets.get(id))
      .filter((asset): asset is Asset => asset !== null)
      .map((asset) => [asset.id, asset]),
  );
  const pathOf = (asset: Asset) =>
    resolveMediaPath(ctx.paths.mediaRoot, asset.relativePath);
  const settings = renderSettingsOf(ctx);

  // Scenes planned as layered 2D animation are drawn from their animation.
  const animations = new Map<string, AnimationSpec>();
  const speech = new Map<string, number[]>();
  const notices: PlanNotice[] = [];
  for (const [index, scene] of scenes.entries()) {
    const plan = plans.get(scene.id);
    if (plan?.method !== "layered-2d" || !plan.animation) continue;
    animations.set(scene.id, plan.animation);
    const narration = scene.audioAssetId
      ? assets.get(scene.audioAssetId)
      : undefined;
    const speaks = plan.animation.characters.some(
      (character) => character.speaksNarration,
    );
    if (!narration || narration.kind !== "audio" || !speaks) continue;
    const { ffmpeg } = ctx.tools;
    const envelope =
      ffmpeg.available && ffmpeg.path
        ? await narrationEnvelope(
            ffmpeg.path,
            pathOf(narration),
            narration.sha256,
            settings.fps,
          )
        : null;
    if (envelope) {
      speech.set(narration.sha256, envelope);
    } else {
      notices.push({
        sceneId: scene.id,
        severity: "warning",
        message: `Scene ${index + 1}: the narration could not be measured, so the speaker's mouth moves with a general rhythm instead of the voice.`,
      });
    }
  }

  const shots = new Map<string, SceneShot[]>();
  const captionTexts = new Map<string, string>();
  for (const plan of plans.values()) {
    if (plan.shots.length > 0) shots.set(plan.sceneId, plan.shots);
    if (plan.captionText !== null) {
      captionTexts.set(plan.sceneId, plan.captionText);
    }
  }
  const result = buildRenderPlan({
    episode,
    scenes,
    assets,
    settings,
    pathOf,
    animations,
    speech,
    shots,
    captionTexts,
  });
  return {
    episode,
    scenes,
    assets,
    pathOf,
    plan: result.plan,
    notices: [...result.notices, ...notices],
    coverage: result.coverage,
  };
}

/** One scene's animation as the render would draw it, for the editor. */
export async function previewAnimation(
  ctx: EngineContext,
  sceneId: string,
): Promise<AnimationPreview> {
  const scene = ctx.db.scenes.get(sceneId);
  if (!scene) throw new AppError("NOT_FOUND", "That scene no longer exists.");
  const { plan } = await planEpisode(ctx, scene.episodeId);
  const { fps } = renderSettingsOf(ctx);
  const animation = ctx.db.plans.get(sceneId);
  const spec =
    animation?.method === "layered-2d" ? (animation.animation ?? null) : null;
  const images: Record<string, Asset> = {};
  for (const [key, image] of Object.entries(spec?.images ?? {})) {
    const asset = image.assetId ? ctx.db.assets.get(image.assetId) : null;
    if (asset) images[key] = asset;
  }
  // The render plan has the scene's length and the measured mouth. When
  // other scenes keep the episode from rendering, they are worked out for
  // this scene alone, by the same rules.
  const planned = plan?.scenes.find((item) => item.sceneId === sceneId);
  if (planned) {
    return {
      animation: spec,
      images,
      mouth:
        planned.shots[0]?.visual.kind === "animation"
          ? planned.shots[0].visual.mouth
          : [],
      fps,
      frames: planned.durationInFrames,
    };
  }
  let frames = Math.max(1, framesOf(scene.durationSeconds, fps));
  let mouth: number[] = [];
  const narration = scene.audioAssetId
    ? ctx.db.assets.get(scene.audioAssetId)
    : null;
  const { ffmpeg } = ctx.tools;
  if (
    spec?.characters.some((character) => character.speaksNarration) &&
    narration?.kind === "audio" &&
    narration.durationSeconds &&
    ffmpeg.available &&
    ffmpeg.path
  ) {
    const lead = framesOf(NARRATION_LEAD_SECONDS, fps);
    const length = framesToContain(narration.durationSeconds, fps);
    frames = Math.max(
      frames,
      lead + length + framesOf(NARRATION_TAIL_SECONDS, fps),
    );
    const voice = await narrationEnvelope(
      ffmpeg.path,
      resolveMediaPath(ctx.paths.mediaRoot, narration.relativePath),
      narration.sha256,
      fps,
    );
    if (voice) {
      mouth = Array.from({ length: frames }, (_, f) =>
        f >= lead && f < lead + length ? (voice[f - lead] ?? 0) : 0,
      );
    }
  }
  return { animation: spec, images, mouth, fps, frames };
}

export async function previewRender(
  ctx: EngineContext,
  episodeId: string,
): Promise<RenderPreview> {
  const { plan, notices, coverage } = await planEpisode(ctx, episodeId);
  return {
    plan,
    planHash: plan ? planIdentity(plan) : null,
    durationSeconds: plan ? plan.durationInFrames / plan.fps : 0,
    notices,
    coverage,
  };
}

/** Every file a plan reads, labelled for error messages. */
function filesOf(
  plan: RenderPlan,
  assets: ReadonlyMap<string, Asset>,
  pathOf: (asset: Asset) => string,
): RenderInput["files"] {
  const byPath = new Map(
    [...assets.values()].map((asset) => [pathOf(asset), asset]),
  );
  const files = new Map<string, RenderInput["files"][number]>();
  const add = (path: string, label: string) => {
    const asset = byPath.get(path);
    if (asset && !files.has(path)) {
      files.set(path, { path, sizeBytes: asset.sizeBytes, label });
    }
  };
  for (const scene of plan.scenes) {
    for (const { visual } of scene.shots) {
      if (visual.kind === "image" || visual.kind === "video") {
        add(visual.src, `Scene ${scene.index + 1}'s ${visual.kind}`);
      } else if (visual.kind === "animation") {
        for (const file of Object.values(visual.images)) {
          add(file.src, `A picture of scene ${scene.index + 1}'s animation`);
        }
      }
    }
  }
  for (const clip of plan.audio) {
    const index = plan.scenes.findIndex((s) => s.sceneId === clip.sceneId);
    add(
      clip.src,
      clip.kind === "music"
        ? "The background music"
        : clip.kind === "effects"
          ? `Scene ${index + 1}'s sound effects`
          : `Scene ${index + 1}'s narration`,
    );
  }
  return [...files.values()];
}

/**
 * Confirms that every file is still there, unchanged in size, and contains
 * what its extension says. Library files are never edited in place, so a
 * different size means the file was damaged or replaced outside the app.
 */
async function checkInputFiles(files: RenderInput["files"]): Promise<void> {
  const problems: string[] = [];
  for (const file of files) {
    const info = await stat(file.path).catch(() => null);
    if (!info?.isFile()) {
      problems.push(`${file.label} is missing from the library.`);
    } else if (info.size !== file.sizeBytes) {
      problems.push(
        `${file.label} has changed on disk since it was imported (${info.size} bytes instead of ${file.sizeBytes}).`,
      );
    } else {
      try {
        await assertContentMatchesExtension(file.path, extensionOf(file.path));
      } catch {
        problems.push(
          `${file.label} is damaged: its content is not what its type says.`,
        );
      }
    }
  }
  if (problems.length > 0) {
    throw new AppError("VALIDATION", problems.join(" "));
  }
}

async function checkOutputDirectory(directory: string): Promise<string> {
  if (!isAbsolute(directory)) {
    throw new AppError("VALIDATION", "The export folder must be a full path.");
  }
  await mkdir(directory, { recursive: true }).catch(() => {});
  const info = await stat(directory).catch(() => null);
  if (!info?.isDirectory()) {
    throw new AppError(
      "VALIDATION",
      `The export folder does not exist and could not be created: ${directory}`,
    );
  }
  try {
    await access(directory, constants.W_OK);
  } catch {
    throw new AppError(
      "VALIDATION",
      `Framebop cannot write to the export folder: ${directory}`,
    );
  }
  return realpath(directory);
}

function requireRenderer(registry: AdapterRegistry): VideoRenderAdapter {
  const adapter = registry.get("video_render", REMOTION_ID);
  if (!adapter) {
    throw new AppError("UNAVAILABLE", "This build has no video renderer.");
  }
  return adapter;
}

export async function startRender(
  ctx: EngineContext,
  queue: JobQueue,
  registry: AdapterRegistry,
  episodeId: string,
): Promise<Job> {
  const adapter = requireRenderer(registry);
  const availability = await adapter.detect();
  if (!availability.available) {
    throw new AppError(
      "UNAVAILABLE",
      availability.reason ?? "The renderer is not available.",
    );
  }
  const { ffmpeg, ffprobe } = ctx.tools;
  if (!ffmpeg.available || !ffprobe.available) {
    throw new AppError(
      "UNAVAILABLE",
      "FFmpeg and ffprobe are needed to check the finished video, and they were not found. Install FFmpeg and scan again.",
    );
  }

  const active = [
    ...ctx.db.jobs.listByStatus("pending"),
    ...ctx.db.jobs.listByStatus("running"),
  ].find((job) => job.type === "video_render" && job.episodeId === episodeId);
  if (active) {
    throw new AppError("CONFLICT", "This episode is already being rendered.");
  }

  const { episode, plan, notices, assets, pathOf } = await planEpisode(
    ctx,
    episodeId,
  );
  if (!plan) {
    throw new AppError(
      "VALIDATION",
      notices
        .filter((notice) => notice.severity === "error")
        .map((notice) => notice.message)
        .join(" "),
    );
  }
  const files = filesOf(plan, assets, pathOf);
  await checkInputFiles(files);
  const outputDirectory = await checkOutputDirectory(exportDirectoryOf(ctx));
  const planHash = planIdentity(plan);

  const input: RenderInput = {
    episodeId,
    title: episode.title,
    plan,
    planHash,
    outputDirectory,
    files,
  };
  const capabilities = await adapter.getCapabilities();
  return queue.submit({
    type: "video_render",
    label: `Render “${episode.title}” · ${plan.width}×${plan.height}`,
    adapterId: adapter.id,
    model: null,
    projectId: episode.projectId,
    episodeId,
    sceneId: null,
    slot: null,
    input,
    metadata: {
      engineName: adapter.name,
      engineVersion: availability.version,
      supportsCancellation: capabilities.supportsCancellation,
      reportsProgress: capabilities.reportsProgress,
      expensive: false,
      durationSeconds: plan.durationInFrames / plan.fps,
      warnings: notices.map((notice) => notice.message),
    },
  });
}

/** A file name from the title, safe on every platform. */
export function exportFileName(title: string, at: Date): string {
  const safe =
    title
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
      .replace(/\s+/g, " ")
      .replace(/^[.\s-]+|[.\s-]+$/g, "")
      .slice(0, 80) || "Episode";
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}.${pad(at.getMinutes())}.${pad(at.getSeconds())}`;
  return `${safe} ${stamp}.mp4`;
}

/** Moves the finished file into place without ever replacing a file. */
async function deliver(source: string, directory: string, name: string) {
  const stem = name.slice(0, -".mp4".length);
  for (let attempt = 1; attempt < 100; attempt += 1) {
    const target = join(
      directory,
      attempt === 1 ? name : `${stem} (${attempt}).mp4`,
    );
    if (await stat(target).catch(() => null)) continue;
    try {
      // Renaming is atomic on one volume, and leaves nothing half-written.
      await rename(source, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
      await copyFile(source, target, constants.COPYFILE_EXCL);
      await unlink(source);
    }
    return target;
  }
  throw new AppError(
    "CONFLICT",
    "Could not find a free file name to export to.",
  );
}

function translate(error: unknown): unknown {
  if (!(error instanceof AdapterError)) return error;
  const code = {
    UNAVAILABLE: "UNAVAILABLE",
    INVALID_REQUEST: "VALIDATION",
    UNSUPPORTED: "UNSUPPORTED",
    CANCELLED: "CANCELLED",
    ENGINE_FAILURE: "ENGINE_FAILURE",
  } as const;
  return new AppError(code[error.code], error.message);
}

/** What the checks should find, from the plan. */
function expectationsOf(plan: RenderPlan) {
  const toSeconds = (frames: number) => frames / plan.fps;
  return {
    width: plan.width,
    height: plan.height,
    fps: plan.fps,
    durationSeconds: toSeconds(plan.durationInFrames),
    narration: plan.audio
      .filter((clip) => clip.kind === "narration")
      .map((clip) => ({
        label: `scene ${plan.scenes.findIndex((s) => s.sceneId === clip.sceneId) + 1}`,
        from: toSeconds(clip.from),
        to: toSeconds(clip.from + clip.durationInFrames),
      })),
    blackAllowed: plan.scenes
      // Only text scenes are meant to be on black.
      .filter((scene) => scene.shots.length === 0)
      .map((scene) => ({
        from: toSeconds(scene.from),
        to: toSeconds(scene.from + scene.durationInFrames),
      })),
  };
}

export function createRenderExecutor(
  ctx: EngineContext,
  registry: AdapterRegistry,
): JobExecutor {
  async function run(job: Job, control: JobControl): Promise<JobResult> {
    const input = RenderInputSchema.parse(job.input);
    control.setStage("preflight");
    const adapter = requireRenderer(registry);
    const availability = await adapter.detect();
    if (!availability.available) {
      throw new AppError(
        "UNAVAILABLE",
        availability.reason ?? "The renderer is not available.",
      );
    }
    const { ffmpeg, ffprobe } = ctx.tools;
    if (!ffmpeg.path || !ffprobe.path) {
      throw new AppError(
        "UNAVAILABLE",
        "FFmpeg is needed to check the finished video.",
      );
    }
    control.reportProgress(null, "Checking the scenes' media");
    await checkInputFiles(input.files);
    control.setStage("preparing");

    const workDirectory = join(ctx.paths.workRoot, job.id);
    await rm(workDirectory, { recursive: true, force: true });
    await mkdir(workDirectory, { recursive: true });
    const startedAt = performance.now();
    try {
      const context: ExecutionContext = {
        signal: control.signal,
        reportProgress: (event) => {
          if (event.stage) control.setStage(event.stage);
          control.reportProgress(event.fraction, event.message ?? null);
        },
        outputDirectory: workDirectory,
        attempt: job.attempt,
        log: (message, data) =>
          ctx.log.scope(adapter.id).info(message, { jobId: job.id, ...data }),
      };
      control.signal.throwIfAborted();
      const result = await adapter
        .generate({ plan: input.plan }, context)
        .catch((error: unknown) => {
          throw translate(error);
        });
      control.signal.throwIfAborted();
      const renderSeconds = (performance.now() - startedAt) / 1000;

      // Nothing is reported as rendered before the file has been checked.
      control.setStage("verifying");
      control.reportProgress(null, "Checking the video");
      const rendered = await realpath(result.artifact.path);
      const validation: OutputValidation = await validateRenderOutput({
        ffprobe: ffprobe.path,
        ffmpeg: ffmpeg.path,
        path: rendered,
        expect: expectationsOf(input.plan),
        inspector: `ffprobe ${ffprobe.version ?? ""}`.trim(),
      });
      control.signal.throwIfAborted();
      if (!validation.passed) {
        // Kept with the failed job, so the history shows what was wrong.
        ctx.db.jobs.update(
          job.id,
          { metadata: { ...job.metadata, validation } },
          ctx.now(),
        );
        const failed = validation.checks
          .filter((check) => check.result === "fail")
          .map((check) => `${check.label}: ${check.detail}`);
        throw new AppError(
          "ENGINE_FAILURE",
          `The rendered video did not pass its checks. ${failed.join("; ")}`,
        );
      }

      control.reportProgress(null, "Saving the video");
      const outputDirectory = await checkOutputDirectory(input.outputDirectory);
      const path = await deliver(
        rendered,
        outputDirectory,
        exportFileName(input.title, new Date()),
      );
      const info = await stat(path);
      const record = {
        id: ctx.newId(),
        episodeId: input.episodeId,
        jobId: job.id,
        path,
        planHash: input.planHash,
        width: input.plan.width,
        height: input.plan.height,
        fps: input.plan.fps,
        durationSeconds:
          validation.probe?.durationSeconds ??
          input.plan.durationInFrames / input.plan.fps,
        sizeBytes: info.size,
        validation,
        createdAt: ctx.now(),
      };
      // The episode may have been deleted while it rendered; the file stays.
      if (ctx.db.episodes.get(input.episodeId)) ctx.db.renders.insert(record);

      return {
        output: {
          path,
          renderId: record.id,
          planHash: input.planHash,
          sizeBytes: info.size,
          durationSeconds: record.durationSeconds,
        },
        metadata: {
          validation,
          renderSeconds: Math.round(renderSeconds * 10) / 10,
        },
      };
    } finally {
      await rm(workDirectory, { recursive: true, force: true });
    }
  }

  return {
    canCancel: () => true,
    run,
  };
}

export async function listRenders(
  ctx: EngineContext,
  episodeId: string,
): Promise<RenderRecord[]> {
  requireEpisode(ctx, episodeId);
  return Promise.all(
    ctx.db.renders.listForEpisode(episodeId).map(async (render) => {
      const info = await stat(render.path).catch(() => null);
      return {
        ...render,
        fileStatus: !info?.isFile()
          ? "missing"
          : info.size === render.sizeBytes
            ? "present"
            : "changed",
      } satisfies RenderRecord;
    }),
  );
}

/** Removes a render from the list. The video file is not touched. */
export function forgetRender(ctx: EngineContext, id: string): void {
  if (!ctx.db.renders.delete(id)) {
    throw new AppError("NOT_FOUND", "That render is no longer listed.");
  }
}
