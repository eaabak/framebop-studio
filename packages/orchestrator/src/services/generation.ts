/**
 * Production jobs that an engine adapter performs for a scene.
 *
 * This module is the only link between the job queue and the adapters, and
 * it knows adapters solely through their interfaces. Nothing here refers to
 * a particular backend, so engines can be added or replaced freely.
 */
import { randomInt } from "node:crypto";
import { mkdir, realpath, rm } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import {
  AdapterError,
  type AdapterRegistry,
  type AnyAdapter,
  type AudioGenerationAdapter,
  type ExecutionContext,
  type ImageGenerationAdapter,
  type MediaInput,
  type VideoGenerationAdapter,
} from "@framebop/ai-adapters";
import {
  AppError,
  IdSchema,
  type Job,
  type JobStage,
  type ParameterSpec,
  type ParameterValue,
  ParameterValueSchema,
  type RpcParsedParams,
  type Scene,
  composeGenerationPrompt,
  extensionOf,
  mediaFormatFor,
} from "@framebop/core";
import { z } from "zod";
import type { EngineContext } from "../context";
import { assertContentMatchesExtension } from "../media/inspect";
import { verifyGeneratedMedia } from "../media/verify";
import { resolveMediaPath } from "../paths";
import { SLOT_FIELD, adoptGeneratedFile } from "./assets";
import type { JobControl, JobExecutor, JobQueue, JobResult } from "./jobs";
import type { ModelService } from "./models";
import type { VisualReferenceService } from "./references";
import {
  removeUnreferencedAssets,
  requireEpisode,
  requireScene,
} from "./shared";

type GenerationTask =
  "image_generation" | "video_generation" | "audio_generation";

const SLOT_OF = {
  image_generation: "image",
  video_generation: "video",
  audio_generation: "audio",
} as const;

const LABELS: Record<GenerationTask, string> = {
  image_generation: "Generate image",
  video_generation: "Generate clip",
  audio_generation: "Generate narration",
};

/** How a picture or clip is made: from words alone, or from a still. */
const MODES = [
  "text-to-image",
  "image-to-image",
  "text-to-video",
  "image-to-video",
] as const;

/** Everything a generation needs, captured when the job was created. */
const GenerationInputSchema = z.object({
  sceneId: IdSchema,
  /** Exactly what the engine receives: the scene's prompt and references. */
  prompt: z.string(),
  /** The prompt before references were added. */
  scenePrompt: z.string().default(""),
  visualReferenceIds: z.array(IdSchema).default([]),
  mode: z.enum(MODES).nullable().default(null),
  negativePrompt: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  seed: z.number().int(),
  durationSeconds: z.number(),
  inputImageAssetId: IdSchema.nullable(),
  parameters: z.record(z.string(), ParameterValueSchema),
  /** The project's language, for speech. */
  language: z.string().default("en"),
});
type GenerationInput = z.infer<typeof GenerationInputSchema>;

/**
 * Checks values against what the adapter declared, fills in defaults, and
 * rejects anything the adapter did not ask for.
 */
export function resolveParameters(
  specs: readonly ParameterSpec[],
  provided: Readonly<Record<string, ParameterValue>>,
): Record<string, ParameterValue> {
  const known = new Set(specs.map((spec) => spec.key));
  const unknown = Object.keys(provided).filter((key) => !known.has(key));
  if (unknown.length > 0) {
    throw new AppError(
      "VALIDATION",
      `This engine has no setting called ${unknown.map((key) => `“${key}”`).join(", ")}.`,
    );
  }

  const resolved: Record<string, ParameterValue> = {};
  for (const spec of specs) {
    const value = provided[spec.key] ?? spec.defaultValue;
    const fail = (expected: string): never => {
      throw new AppError("VALIDATION", `${spec.label} must be ${expected}.`);
    };
    switch (spec.type) {
      case "number":
      case "integer": {
        if (typeof value !== "number" || !Number.isFinite(value)) {
          fail("a number");
        } else if (spec.type === "integer" && !Number.isInteger(value)) {
          fail("a whole number");
        } else if (spec.min !== undefined && value < spec.min) {
          fail(`at least ${spec.min}`);
        } else if (spec.max !== undefined && value > spec.max) {
          fail(`at most ${spec.max}`);
        }
        break;
      }
      case "boolean":
        if (typeof value !== "boolean") fail("on or off");
        break;
      case "enum":
        if (typeof value !== "string" || !spec.options?.includes(value)) {
          fail(`one of ${spec.options?.join(", ")}`);
        }
        break;
      case "string":
        if (typeof value !== "string") fail("text");
        break;
    }
    resolved[spec.key] = value;
  }
  return resolved;
}

function promptFor(task: GenerationTask, scene: Scene): string {
  if (task === "audio_generation") return scene.narrationText.trim();
  // A clip is described by how the frame moves, falling back to what it shows.
  return task === "video_generation"
    ? scene.motionPrompt.trim() || scene.imagePrompt.trim()
    : scene.imagePrompt.trim();
}

/**
 * Validates a request against what the chosen engine can really do right
 * now, and queues it. Nothing is started here: the job waits its turn.
 */
export async function createGenerationJob(
  ctx: EngineContext,
  queue: JobQueue,
  registry: AdapterRegistry,
  models: Pick<ModelService, "isOfferedReference">,
  references: Pick<VisualReferenceService, "resolve">,
  params: RpcParsedParams<"jobs.createGeneration">,
): Promise<Job> {
  const scene = requireScene(ctx, params.sceneId);
  const episode = requireEpisode(ctx, scene.episodeId);
  const slot = SLOT_OF[params.task];
  const visual = params.task !== "audio_generation";

  const adapter: AnyAdapter | null = registry.get(
    params.task,
    params.adapterId,
  );
  if (adapter === null) {
    throw new AppError("NOT_FOUND", "That engine cannot do this kind of work.");
  }
  const [availability, capabilities] = await Promise.all([
    adapter.detect(),
    adapter.getCapabilities(),
  ]);
  if (!availability.available) {
    throw new AppError(
      "UNAVAILABLE",
      availability.reason ?? `${adapter.name} is not available right now.`,
    );
  }
  // The engine, not the interface, is where this rule is enforced: a run that
  // can occupy the machine for minutes never starts without stated consent.
  if (capabilities.expensive && !params.approvedExpensive) {
    throw new AppError(
      "VALIDATION",
      `${adapter.name} runs a real model and may take a long time. Confirm that you want to start it.`,
    );
  }

  if (params.model !== null && isAbsolute(params.model)) {
    // A path reaches an engine only if the model picker offered it for this
    // engine: a verified installation or a file in a folder the user added.
    if (
      !(await models.isOfferedReference(params.task, adapter.id, params.model))
    ) {
      throw new AppError(
        "VALIDATION",
        "That model file is not one this engine was offered. Choose it again from the list.",
      );
    }
  } else if (capabilities.models.length > 0) {
    if (
      params.model !== null &&
      !capabilities.models.some((m) => m.id === params.model)
    ) {
      throw new AppError(
        "VALIDATION",
        "That model is not offered by this engine.",
      );
    }
  }
  if (capabilities.requiresModel && !params.model) {
    throw new AppError(
      "VALIDATION",
      "Choose the model this engine should use.",
    );
  }
  if (visual && (params.width === undefined || params.height === undefined)) {
    throw new AppError("VALIDATION", "Choose an output size.");
  }
  const width = params.width ?? 0;
  const height = params.height ?? 0;
  if (
    visual &&
    capabilities.resolutions.length > 0 &&
    !capabilities.resolutions.some(
      (r) => r.width === width && r.height === height,
    )
  ) {
    throw new AppError(
      "VALIDATION",
      "This engine does not offer that output size.",
    );
  }

  // Settings an engine cannot take are refused, never quietly dropped: the
  // person asked for them and would otherwise believe they were used.
  const refuse = (what: string): never => {
    throw new AppError("UNSUPPORTED", `${adapter.name} ${what}`);
  };
  if (params.negativePrompt && !capabilities.supportsNegativePrompt) {
    refuse("does not take a negative prompt.");
  }
  if (params.seed !== null && !capabilities.supportsSeed) {
    refuse("does not take a seed.");
  }
  if (!visual && params.visualReferenceIds.length > 0) {
    refuse("makes narration; visual references do not apply to it.");
  }
  if (params.task !== "video_generation" && params.clipSeconds !== undefined) {
    refuse("does not make clips, so a clip length does not apply.");
  }
  const linked = references.resolve(
    episode.projectId,
    params.visualReferenceIds,
  );

  const scenePrompt = params.prompt ?? promptFor(params.task, scene);
  const prompt = visual
    ? composeGenerationPrompt(scenePrompt, linked)
    : scenePrompt;
  if (capabilities.requiresPrompt && scenePrompt.trim().length === 0) {
    throw new AppError(
      "VALIDATION",
      params.task === "audio_generation"
        ? "Write the narration text for this scene first."
        : params.task === "video_generation"
          ? "Write a motion prompt (or an image prompt) for this scene first."
          : "Write an image prompt for this scene first.",
    );
  }

  // The starting image: chosen explicitly, or for a clip the scene's own.
  const acceptsImage =
    capabilities.requiresInputImage || capabilities.acceptsInputImage === true;
  const inputImageAssetId =
    params.inputImageAssetId !== undefined
      ? params.inputImageAssetId
      : params.task === "video_generation" && acceptsImage
        ? scene.imageAssetId
        : null;
  if (inputImageAssetId !== null) {
    if (!visual || !acceptsImage) refuse("cannot start from an image.");
    const asset = ctx.db.assets.get(inputImageAssetId);
    if (asset?.projectId !== episode.projectId || asset.kind !== "image") {
      throw new AppError(
        "VALIDATION",
        "The starting image must be a picture in this project's library.",
      );
    }
  }
  if (capabilities.requiresInputImage && inputImageAssetId === null) {
    throw new AppError(
      "VALIDATION",
      "This engine animates a still image. Add an image to the scene first.",
    );
  }

  const maxClip = capabilities.maxClipSeconds ?? null;
  if (
    params.clipSeconds !== undefined &&
    maxClip !== null &&
    params.clipSeconds > maxClip
  ) {
    refuse(`makes clips of at most ${maxClip} seconds.`);
  }
  const durationSeconds =
    params.task === "video_generation"
      ? (params.clipSeconds ??
        (maxClip === null
          ? scene.durationSeconds
          : Math.min(scene.durationSeconds, maxClip)))
      : scene.durationSeconds;

  const mode: GenerationInput["mode"] =
    params.task === "image_generation"
      ? inputImageAssetId
        ? "image-to-image"
        : "text-to-image"
      : params.task === "video_generation"
        ? inputImageAssetId
          ? "image-to-video"
          : "text-to-video"
        : null;
  // A reference's seed keeps a character's runs repeatable when none is set.
  const referenceSeed = capabilities.supportsSeed
    ? (linked.find((reference) => reference.seed !== null)?.seed ?? null)
    : null;

  const input: GenerationInput = {
    sceneId: scene.id,
    prompt,
    scenePrompt,
    visualReferenceIds: linked.map((reference) => reference.id),
    mode,
    negativePrompt: params.negativePrompt,
    width,
    height,
    // Chosen once and stored, so a retry repeats exactly this run.
    seed: params.seed ?? referenceSeed ?? randomInt(0, 2 ** 32),
    durationSeconds,
    inputImageAssetId,
    parameters: resolveParameters(capabilities.parameters, params.parameters),
    language: ctx.db.projects.get(episode.projectId)?.language ?? "en",
  };

  // Checked last, so a faulty request reports its own problem. One
  // generation of each kind per scene at a time: a second press of the
  // button, or a second window, must not start the same work twice.
  const duplicate = [
    ...ctx.db.jobs.listByStatus("pending"),
    ...ctx.db.jobs.listByStatus("running"),
  ].some((job) => job.sceneId === scene.id && job.type === params.task);
  if (duplicate) {
    throw new AppError(
      "CONFLICT",
      "This scene already has one of these waiting or being made. Wait for it, or stop it, first.",
    );
  }

  return queue.submit({
    type: params.task,
    label: `${LABELS[params.task]} · ${adapter.name}`,
    adapterId: adapter.id,
    model: params.model || null,
    projectId: episode.projectId,
    episodeId: episode.id,
    sceneId: scene.id,
    slot,
    input,
    // Recorded with the job so its row explains itself later, even if the
    // engine has changed or gone by then.
    metadata: {
      engineName: adapter.name,
      engineVersion: availability.version,
      isTest: adapter.isTest,
      maturity: capabilities.maturity,
      supportsCancellation: capabilities.supportsCancellation,
      reportsProgress: capabilities.reportsProgress,
      expensive: capabilities.expensive,
      approvedExpensive: capabilities.expensive
        ? params.approvedExpensive
        : null,
    },
  });
}

function isInside(directory: string, path: string): boolean {
  const fromDirectory = relative(directory, path);
  return (
    fromDirectory !== "" &&
    !fromDirectory.startsWith("..") &&
    !isAbsolute(fromDirectory)
  );
}

/** Maps an adapter's failure onto the engine's error vocabulary. */
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

export function createGenerationExecutor(
  ctx: EngineContext,
  registry: AdapterRegistry,
): JobExecutor {
  async function run(job: Job, control: JobControl): Promise<JobResult> {
    const task = job.type as GenerationTask;
    const slot = SLOT_OF[task];
    const input = GenerationInputSchema.parse(job.input);
    control.setStage("preparing");

    const adapter = registry.get(task, job.adapterId ?? "");
    if (adapter === null) {
      throw new AppError(
        "UNAVAILABLE",
        "The engine this job was created for is not part of this version of Framebop Studio.",
      );
    }
    // Availability can change between queueing and running: an application
    // may have been closed, a tool uninstalled.
    const availability = await adapter.detect();
    if (!availability.available) {
      throw new AppError(
        "UNAVAILABLE",
        availability.reason ?? `${adapter.name} is not available.`,
      );
    }
    const scene = ctx.db.scenes.get(input.sceneId);
    if (scene === null) {
      throw new AppError(
        "NOT_FOUND",
        "The scene this job was for has been deleted.",
      );
    }
    const { projectId } = requireEpisode(ctx, scene.episodeId);

    let inputImage: MediaInput | null = null;
    if (input.inputImageAssetId !== null) {
      const asset = ctx.db.assets.get(input.inputImageAssetId);
      if (asset === null) {
        throw new AppError(
          "NOT_FOUND",
          "The starting image of this job is no longer in the library.",
        );
      }
      inputImage = {
        path: resolveMediaPath(ctx.paths.mediaRoot, asset.relativePath),
        mimeType: asset.mimeType,
        width: asset.width,
        height: asset.height,
      };
    }

    // Each job gets its own empty folder, the only place its adapter may
    // write. It is removed again whatever happens.
    const workDirectory = join(ctx.paths.workRoot, job.id);
    await rm(workDirectory, { recursive: true, force: true });
    await mkdir(workDirectory, { recursive: true });
    const startedAt = performance.now();

    try {
      // Phases come from the adapter when it can tell them apart. One that
      // reports nothing at all is generating from the moment it is called.
      let stage: JobStage = "preparing";
      const enter = (next: JobStage) => {
        if (next === stage) return;
        stage = next;
        control.setStage(next);
      };
      if (job.metadata.reportsProgress === false) enter("generating");
      const context: ExecutionContext = {
        signal: control.signal,
        reportProgress: (event) => {
          enter(event.stage ?? (stage === "preparing" ? "generating" : stage));
          control.reportProgress(event.fraction, event.message ?? null);
        },
        outputDirectory: workDirectory,
        attempt: job.attempt,
        log: (message, data) =>
          ctx.log.scope(adapter.id).info(message, { jobId: job.id, ...data }),
      };
      const request = {
        model: job.model,
        prompt: input.prompt,
        negativePrompt: input.negativePrompt,
        width: input.width,
        height: input.height,
        seed: input.seed,
        parameters: input.parameters,
      };

      // A cancel may have arrived during the checks above. Do not rely on the
      // adapter to notice a signal that was already aborted when it started.
      control.signal.throwIfAborted();
      const result = await (
        task === "audio_generation"
          ? (adapter as AudioGenerationAdapter).generate(
              {
                model: job.model,
                text: input.prompt,
                language: input.language,
                parameters: input.parameters,
              },
              context,
            )
          : task === "image_generation"
            ? (adapter as ImageGenerationAdapter).generate(
                { ...request, inputImage },
                context,
              )
            : (adapter as VideoGenerationAdapter).generate(
                {
                  ...request,
                  inputImage,
                  durationSeconds: input.durationSeconds,
                },
                context,
              )
      ).catch((error: unknown) => {
        throw translate(error);
      });
      // A cancel that arrived while the adapter was finishing still counts.
      control.signal.throwIfAborted();
      enter("validating");

      // Trust nothing about the reported file: it must really be inside the
      // job's folder, be of the kind the job is for, and contain that kind.
      const artifactPath = await realpath(result.artifact.path).catch(
        () => null,
      );
      const root = await realpath(workDirectory);
      if (artifactPath === null || !isInside(root, artifactPath)) {
        throw new AppError(
          "ENGINE_FAILURE",
          `${adapter.name} did not leave its output in its working folder.`,
        );
      }
      const format = mediaFormatFor(artifactPath);
      if (
        format === null ||
        format.kind !== slot ||
        result.artifact.kind !== slot
      ) {
        throw new AppError(
          "ENGINE_FAILURE",
          `${adapter.name} produced a file that is not a usable ${slot}.`,
        );
      }
      const extension = extensionOf(artifactPath);
      await assertContentMatchesExtension(artifactPath, extension);
      // Decode what was written and measure it. A file that fails never
      // reaches the library, so it cannot replace anything in a scene.
      const verification =
        slot === "audio"
          ? null
          : await verifyGeneratedMedia({
              ffmpeg: ctx.tools.ffmpeg.available ? ctx.tools.ffmpeg.path : null,
              ffprobe: ctx.tools.ffprobe.available
                ? ctx.tools.ffprobe.path
                : null,
              path: artifactPath,
              kind: slot,
              inputImagePath: slot === "video" ? inputImage?.path : null,
              signal: control.signal,
            });
      if (verification?.status === "failed") {
        throw new AppError(
          "ENGINE_FAILURE",
          `${adapter.name} produced a ${slot} that did not pass verification: ${verification.problems.join(" ")}`,
        );
      }

      if (result.expectedVideo && slot === "video") {
        const expected = result.expectedVideo;
        if (
          verification?.status !== "passed" ||
          verification.width !== expected.width ||
          verification.height !== expected.height ||
          verification.frames !== expected.frames ||
          verification.fps === null ||
          Math.abs(verification.fps - expected.fps) > 0.01
        )
          throw new AppError(
            "ENGINE_FAILURE",
            "The generated video did not match its promised size, frame rate or frame count. No scene media was replaced.",
          );
      }

      const { asset, reused } = await adoptGeneratedFile(ctx, {
        projectId,
        filePath: artifactPath,
        kind: slot,
        mimeType: format.mimeType,
        extension,
        originalFilename: `${adapter.id}-${slot}.${extension}`,
      });

      // The result goes straight into the scene only if the slot is empty.
      // Otherwise it stays with the job, and replacing what the scene already
      // has is left to the user.
      const now = ctx.now();
      const attached = ctx.db.transaction(() => {
        if (!reused) ctx.db.assets.insert(asset);
        // Referencing the asset from the job keeps it from being cleaned up
        // as unused while it is not (or not yet) in a scene.
        ctx.db.jobs.update(job.id, { outputAssetId: asset.id }, now);
        const current = ctx.db.scenes.get(input.sceneId);
        if (current === null || current[SLOT_FIELD[slot]] !== null)
          return false;
        ctx.db.scenes.setSlot(input.sceneId, slot, asset.id, now);
        ctx.db.projects.touch(projectId, now);
        return true;
      });
      if (attached) {
        ctx.emit({
          type: "scene.updated",
          scene: requireScene(ctx, input.sceneId),
          assets: [asset],
        });
      }

      return {
        output: {
          assetId: asset.id,
          relativePath: asset.relativePath,
          attached,
          model: result.model,
          seed: input.seed,
          mode: input.mode,
          verification,
          requested: {
            width: input.width,
            height: input.height,
            durationSeconds: slot === "video" ? input.durationSeconds : null,
          },
        },
        metadata: {
          ...result.details,
          runSeconds: Math.round((performance.now() - startedAt) / 100) / 10,
        },
      };
    } finally {
      await rm(workDirectory, { recursive: true, force: true });
      // Whatever the adapter keeps loaded between runs is let go, so the next
      // job in the lane (a language model, a render) has the memory.
      await adapter.release?.().catch((error: unknown) =>
        ctx.log.scope(adapter.id).warn("Could not release the engine", {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  return {
    // Captured when the job was created, so it is known without asking the
    // adapter again, and stays true to what the user was told.
    canCancel: (job) => job.metadata.supportsCancellation !== false,
    run,
  };
}

/**
 * Puts a completed job's output into its scene, replacing whatever the slot
 * holds. This is how a result is chosen when the scene already had media, and
 * how the user switches between the results of several attempts.
 */
export async function applyJobOutput(
  ctx: EngineContext,
  jobId: string,
): Promise<Scene> {
  const job = ctx.db.jobs.get(jobId);
  if (!job) throw new AppError("NOT_FOUND", "That job no longer exists.");
  if (
    job.status !== "completed" ||
    !job.outputAssetId ||
    !job.slot ||
    !job.sceneId
  ) {
    throw new AppError("CONFLICT", "That job has no result that can be used.");
  }
  const asset = ctx.db.assets.get(job.outputAssetId);
  if (!asset || asset.kind !== job.slot) {
    throw new AppError(
      "NOT_FOUND",
      "The result of that job is no longer in the library.",
    );
  }
  const scene = requireScene(ctx, job.sceneId);
  const { projectId } = requireEpisode(ctx, scene.episodeId);

  const now = ctx.now();
  ctx.db.transaction(() => {
    ctx.db.scenes.setSlot(scene.id, asset.kind, asset.id, now);
    ctx.db.projects.touch(projectId, now);
  });
  await removeUnreferencedAssets(ctx, projectId);
  const updated = requireScene(ctx, scene.id);
  ctx.emit({ type: "scene.updated", scene: updated, assets: [asset] });
  return updated;
}
