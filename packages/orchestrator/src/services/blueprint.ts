/**
 * Production Blueprint: a production plan for every scene of an episode,
 * what each production method needs and which engines can carry it out, and
 * a preflight that reports actual readiness.
 *
 * Nothing here generates media. Narration timing comes from audio the user
 * chose to generate (or import); measured lengths are applied only when the
 * user asks, and never over a duration they set by hand.
 */
import { access } from "node:fs/promises";
import { type AdapterRegistry, describeEngines } from "@framebop/ai-adapters";
import {
  AppError,
  type AnimationSpec,
  type AnimationTemplate,
  type Blueprint,
  type BlueprintScene,
  type EngineStatus,
  type MethodAvailability,
  PRODUCTION_METHOD_LABELS,
  PRODUCTION_METHODS,
  type PreflightIssue,
  type PreflightReport,
  type ProductionMethod,
  SCENE_DURATION_MAX,
  SCENE_DURATION_MIN,
  type Scene,
  type ScenePlan,
  type ScenePlanPatch,
  estimateNarrationSeconds,
  formatClock,
} from "@framebop/core";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { animationTemplate, labSoundtrack, wavFile } from "@framebop/renderer";
import type { EngineContext } from "../context";
import { resolveMediaPath } from "../paths";
import { importLibraryPicture, importLibrarySound } from "./assets";
import type { ModelService } from "./models";
import { getSettings } from "./settings";
import { requireEpisode, requireProject } from "./shared";

/** The engine task each generated method needs. */
const METHOD_TASK: Partial<
  Record<ProductionMethod, "image_generation" | "video_generation">
> = {
  "image-generation": "image_generation",
  "image-to-video": "video_generation",
  "text-to-video": "video_generation",
};

/** The media a scene needs in the end, by method. */
const METHOD_MEDIA: Record<ProductionMethod, "image" | "video" | "animation"> =
  {
    "static-image": "image",
    "layered-2d": "animation",
    "video-clip": "video",
    "image-generation": "image",
    "image-to-video": "video",
    "text-to-video": "video",
  };

export function defaultPlan(scene: Scene, now: string): ScenePlan {
  return {
    sceneId: scene.id,
    method: scene.videoAssetId ? "video-clip" : "static-image",
    engineId: null,
    model: null,
    requiredAssets: [],
    claims: [],
    research: [],
    durationSource: "estimate",
    notes: "",
    proposedNarration: null,
    proposalJobId: null,
    storyDraftId: null,
    draftSceneId: null,
    animation: null,
    visualReferenceIds: [],
    shots: [],
    captionText: null,
    updatedAt: now,
  };
}

/** The renderer's temporary test art, wherever the package is installed. */
const TEST_ART_DIRECTORY = join(
  dirname(
    createRequire(import.meta.url).resolve("@framebop/renderer/package.json"),
  ),
  "test-art",
  "png",
);

/** The 2D animation engine is part of the renderer. */
export const ANIMATION_ENGINE = {
  id: "framebop-2d",
  name: "Framebop 2D animation",
} as const;

export class BlueprintService {
  constructor(
    private readonly ctx: EngineContext,
    private readonly registry: AdapterRegistry,
    private readonly models: ModelService,
  ) {}

  /** Plans for every scene of the episode; missing ones are created. */
  private plans(episodeId: string): {
    scenes: Scene[];
    plans: Map<string, ScenePlan>;
  } {
    const scenes = this.ctx.db.scenes.listForEpisode(episodeId);
    const plans = this.ctx.db.plans.forEpisode(episodeId);
    const now = this.ctx.now();
    for (const scene of scenes) {
      if (!plans.has(scene.id)) {
        const plan = defaultPlan(scene, now);
        this.ctx.db.plans.put(plan);
        plans.set(scene.id, plan);
      }
    }
    return { scenes, plans };
  }

  /** Which methods engines in this build can carry out, and why not. */
  methods(engines: EngineStatus[]): MethodAvailability[] {
    const renderer = engines.flatMap((engine) =>
      engine.capabilities
        .filter((capability) => capability.task === "video_render")
        .map((capability) => ({ engine, capability })),
    );
    const rendererAvailable = renderer.some(
      (item) => item.capability.available,
    );
    return PRODUCTION_METHODS.map((method): MethodAvailability => {
      const label = PRODUCTION_METHOD_LABELS[method];
      const task = METHOD_TASK[method];
      if (method === "layered-2d") {
        const reason = rendererAvailable
          ? null
          : "It is drawn by the renderer, which is not available right now.";
        return {
          method,
          label,
          available: true,
          reason:
            reason ??
            "Drawn frame by frame by the built-in 2D engine: vector props, articulated characters and a camera, from a scene configuration.",
          engines: [
            {
              ...ANIMATION_ENGINE,
              available: rendererAvailable,
              maturity: "verified",
              reason,
            },
          ],
        };
      }
      if (!task) {
        // Imported or composed media, put together by the renderer.
        return {
          method,
          label,
          available: true,
          reason: rendererAvailable
            ? "Import the media; the renderer composes it."
            : "Import the media. The renderer is not available right now, so the episode cannot be rendered yet.",
          engines: renderer.map(({ engine, capability }) => ({
            id: engine.id,
            name: engine.name,
            available: capability.available,
            maturity: capability.maturity,
            reason: capability.reason,
          })),
        };
      }
      const candidates = engines
        .filter((engine) => !engine.isTest)
        .flatMap((engine) =>
          engine.capabilities
            .filter(
              (capability) =>
                capability.task === task &&
                (method !== "text-to-video" ||
                  !capability.requiresInputImage) &&
                (method !== "image-to-video" ||
                  capability.acceptsInputImage ||
                  capability.requiresInputImage),
            )
            .map((capability) => ({ engine, capability })),
        );
      const usable = candidates.filter((item) => item.capability.available);
      return {
        method,
        label,
        available: usable.length > 0,
        reason:
          usable.length > 0
            ? `Can be made with ${usable.map((item) => `${item.engine.name}${item.capability.maturity === "experimental" ? " (experimental)" : ""}`).join(", ")}.`
            : candidates.length > 0
              ? `No engine for this is available right now: ${candidates.map((item) => `${item.engine.name}: ${item.capability.reason ?? "unavailable"}`).join("; ")}`
              : "No engine in this build makes this.",
        engines: candidates.map(({ engine, capability }) => ({
          id: engine.id,
          name: engine.name,
          available: capability.available,
          maturity: capability.maturity,
          reason: capability.reason,
        })),
      };
    });
  }

  private engines(): Promise<EngineStatus[]> {
    return describeEngines(this.registry, this.ctx.tools);
  }

  async get(episodeId: string): Promise<Blueprint> {
    const episode = requireEpisode(this.ctx, episodeId);
    const project = requireProject(this.ctx, episode.projectId);
    const { wordsPerMinute: settingsRate } = {
      wordsPerMinute: getSettings(this.ctx).narrationWordsPerMinute,
    };
    const { scenes, plans } = this.plans(episodeId);
    const storyDraftId =
      [...plans.values()].find((plan) => plan.storyDraftId)?.storyDraftId ??
      null;
    const draft = storyDraftId ? this.ctx.db.stories.get(storyDraftId) : null;
    const wordsPerMinute = draft?.settings.wordsPerMinute ?? settingsRate;
    const assets = this.ctx.db.assets.getMany(
      scenes.flatMap((scene) =>
        [scene.audioAssetId].filter((id): id is string => id !== null),
      ),
    );
    const previews = this.previews(scenes);

    const blueprintScenes: BlueprintScene[] = scenes.map((scene, index) => {
      const plan = plans.get(scene.id) as ScenePlan;
      const audio = scene.audioAssetId
        ? assets.get(scene.audioAssetId)
        : undefined;
      const words = scene.narrationText.trim().match(/\S+/g)?.length ?? 0;
      const preview = previews.get(scene.id) ?? null;
      return {
        sceneId: scene.id,
        index,
        title: scene.title,
        narrationText: scene.narrationText,
        visualDescription: scene.imagePrompt,
        motionPrompt: scene.motionPrompt,
        cameraMotion: scene.cameraMotion,
        transition: scene.transition,
        durationSeconds: scene.durationSeconds,
        plan,
        narration: {
          words,
          estimatedSeconds: estimateNarrationSeconds(
            scene.narrationText,
            wordsPerMinute,
          ),
          measuredSeconds: audio?.durationSeconds ?? null,
          previewJobId: preview?.jobId ?? null,
          previewSeconds: preview?.seconds ?? null,
        },
        media: {
          image: scene.imageAssetId !== null,
          video: scene.videoAssetId !== null,
          audio: scene.audioAssetId !== null,
        },
      };
    });

    // Sections of the story draft, mapped to the production scenes made from it.
    const byDraftScene = new Map(
      [...plans.values()]
        .filter((plan) => plan.draftSceneId)
        .map((plan) => [plan.draftSceneId as string, plan.sceneId]),
    );
    const sections =
      draft?.outline?.sections.map((section) => {
        const sceneIds = draft.scenes
          .filter((scene) => scene.sectionId === section.id)
          .map((scene) => byDraftScene.get(scene.id))
          .filter(
            (id): id is string =>
              id !== undefined &&
              blueprintScenes.some((item) => item.sceneId === id),
          );
        const members = blueprintScenes.filter((item) =>
          sceneIds.includes(item.sceneId),
        );
        return {
          title: section.title,
          sceneIds,
          plannedSeconds: members.reduce(
            (sum, item) => sum + item.durationSeconds,
            0,
          ),
          estimatedSeconds: members.reduce(
            (sum, item) => sum + item.narration.estimatedSeconds,
            0,
          ),
        };
      }) ?? [];
    const measured = blueprintScenes.filter(
      (item) => item.narration.measuredSeconds !== null,
    );

    return {
      projectId: project.id,
      episodeId,
      targetSeconds: project.targetDurationSeconds,
      wordsPerMinute,
      plannedSeconds: blueprintScenes.reduce(
        (sum, item) => sum + item.durationSeconds,
        0,
      ),
      estimatedNarrationSeconds: blueprintScenes.reduce(
        (sum, item) => sum + item.narration.estimatedSeconds,
        0,
      ),
      measuredNarrationSeconds:
        measured.length > 0
          ? measured.reduce(
              (sum, item) => sum + (item.narration.measuredSeconds ?? 0),
              0,
            )
          : null,
      sections,
      scenes: blueprintScenes,
      methods: this.methods(await this.engines()),
      storyDraftId,
    };
  }

  /** Finished narration jobs whose audio is not (yet) in the scene. */
  private previews(
    scenes: Scene[],
  ): Map<string, { jobId: string; seconds: number | null }> {
    const ids = new Set(scenes.map((scene) => scene.id));
    const result = new Map<string, { jobId: string; seconds: number | null }>();
    const jobs = this.ctx.db.jobs
      .listRecent(500)
      .filter(
        (job) =>
          job.type === "audio_generation" &&
          job.status === "completed" &&
          job.sceneId &&
          ids.has(job.sceneId) &&
          job.outputAssetId,
      );
    const assets = this.ctx.db.assets.getMany(
      jobs.map((job) => job.outputAssetId as string),
    );
    for (const job of jobs) {
      const scene = scenes.find((item) => item.id === job.sceneId);
      if (
        !scene ||
        scene.audioAssetId === job.outputAssetId ||
        result.has(scene.id)
      )
        continue;
      result.set(scene.id, {
        jobId: job.id,
        seconds:
          assets.get(job.outputAssetId as string)?.durationSeconds ?? null,
      });
    }
    return result;
  }

  updatePlan(sceneId: string, patch: ScenePlanPatch): ScenePlan {
    const scene = this.ctx.db.scenes.get(sceneId);
    if (!scene) throw new AppError("NOT_FOUND", "That scene no longer exists.");
    if (patch.shots) {
      // Shots show this project's own media, of the kind they say.
      const { projectId } = requireEpisode(this.ctx, scene.episodeId);
      for (const shot of patch.shots) {
        const asset = this.ctx.db.assets.get(shot.assetId);
        if (
          asset?.projectId !== projectId ||
          asset.kind !== (shot.kind === "clip" ? "video" : "image")
        ) {
          throw new AppError(
            "VALIDATION",
            "A shot must use a clip or picture from this project's library.",
          );
        }
        if (
          shot.kind === "clip" &&
          shot.trimEnd !== null &&
          shot.trimEnd <= shot.trimStart
        ) {
          throw new AppError(
            "VALIDATION",
            "A clip's trim must end after it starts.",
          );
        }
      }
    }
    if (patch.visualReferenceIds) {
      const { projectId } = requireEpisode(this.ctx, scene.episodeId);
      for (const id of patch.visualReferenceIds) {
        if (this.ctx.db.visualReferences.get(id)?.projectId !== projectId) {
          throw new AppError(
            "VALIDATION",
            "A chosen reference is not part of this project.",
          );
        }
      }
    }
    const current =
      this.ctx.db.plans.get(sceneId) ?? defaultPlan(scene, this.ctx.now());
    const next: ScenePlan = {
      ...current,
      ...Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined),
      ),
      updatedAt: this.ctx.now(),
    };
    // An engine of another method does not carry over.
    if (
      patch.method &&
      patch.method !== current.method &&
      patch.engineId === undefined
    ) {
      next.engineId = null;
      next.model = null;
    }
    this.ctx.db.plans.put(next);
    return next;
  }

  /**
   * Draws the scene with a ready-made animation from the 2D engine. Its
   * pictures (temporary test art) are copied into the project's library.
   */
  async applyAnimationTemplate(
    sceneId: string,
    template: AnimationTemplate,
  ): Promise<ScenePlan> {
    return this.useAnimation(sceneId, animationTemplate(template), template);
  }

  /**
   * Draws the scene with an animation: its pictures (temporary test art)
   * are copied into the project's library, a Lab experiment's sound is made
   * for its timeline, and the scene lasts exactly as long as an experiment.
   */
  async useAnimation(
    sceneId: string,
    animation: AnimationSpec,
    name: string,
  ): Promise<ScenePlan> {
    const scene = this.ctx.db.scenes.get(sceneId);
    if (!scene) throw new AppError("NOT_FOUND", "That scene no longer exists.");
    const episode = requireEpisode(this.ctx, scene.episodeId);
    for (const image of Object.values(animation.images)) {
      if (image.assetId) continue;
      const asset = await importLibraryPicture(
        this.ctx,
        episode.projectId,
        join(TEST_ART_DIRECTORY, image.name),
      );
      image.assetId = asset.id;
    }
    if (animation.lab) {
      const sound = await importLibrarySound(
        this.ctx,
        episode.projectId,
        `${name}.wav`,
        wavFile(labSoundtrack(animation)),
      );
      animation.lab.soundAssetId = sound.id;
      const seconds = animation.durationFrames / animation.fps;
      this.ctx.db.scenes.update(
        sceneId,
        { durationSeconds: seconds },
        this.ctx.now(),
      );
    }
    const plan = this.updatePlan(sceneId, {
      method: "layered-2d",
      engineId: ANIMATION_ENGINE.id,
      animation,
    });
    if (!animation.lab) return plan;
    this.markManualDuration(sceneId);
    return this.ctx.db.plans.get(sceneId) ?? plan;
  }

  /** Called when the user sets a scene's duration by hand. */
  markManualDuration(sceneId: string): void {
    const plan = this.ctx.db.plans.get(sceneId);
    if (plan && plan.durationSource !== "manual") {
      this.ctx.db.plans.put({
        ...plan,
        durationSource: "manual",
        updatedAt: this.ctx.now(),
      });
    }
  }

  /** Sets the scene's duration to its narration audio's measured length. */
  useMeasuredDuration(sceneId: string): Scene {
    const scene = this.ctx.db.scenes.get(sceneId);
    if (!scene) throw new AppError("NOT_FOUND", "That scene no longer exists.");
    const audio = scene.audioAssetId
      ? this.ctx.db.assets.getMany([scene.audioAssetId]).get(scene.audioAssetId)
      : undefined;
    const seconds = audio?.durationSeconds;
    if (!seconds)
      throw new AppError(
        "VALIDATION",
        "This scene has no narration audio with a measured length.",
      );
    const duration = Math.min(
      SCENE_DURATION_MAX,
      Math.max(SCENE_DURATION_MIN, Math.round(seconds * 10) / 10),
    );
    const now = this.ctx.now();
    this.ctx.db.transaction(() => {
      this.ctx.db.scenes.update(sceneId, { durationSeconds: duration }, now);
      const plan = this.ctx.db.plans.get(sceneId) ?? defaultPlan(scene, now);
      this.ctx.db.plans.put({
        ...plan,
        durationSource: "audio",
        updatedAt: now,
      });
    });
    return this.ctx.db.scenes.get(sceneId) as Scene;
  }

  setProposal(
    sceneId: string,
    narration: string | null,
    jobId: string | null,
  ): void {
    const scene = this.ctx.db.scenes.get(sceneId);
    if (!scene) return;
    const plan =
      this.ctx.db.plans.get(sceneId) ?? defaultPlan(scene, this.ctx.now());
    this.ctx.db.plans.put({
      ...plan,
      proposedNarration: narration,
      proposalJobId: jobId,
      updatedAt: this.ctx.now(),
    });
  }

  /** Puts the suggested narration in the scene. Its old text is replaced only now. */
  acceptProposal(sceneId: string): Scene {
    const plan = this.ctx.db.plans.get(sceneId);
    if (!plan?.proposedNarration)
      throw new AppError(
        "NOT_FOUND",
        "There is no suggested narration for this scene.",
      );
    // New facts the suggestion states come with it, to be checked.
    const output = plan.proposalJobId
      ? this.ctx.db.jobs.get(plan.proposalJobId)?.output
      : null;
    const claims = Array.isArray(output?.claims)
      ? (output.claims as string[])
      : [];
    const now = this.ctx.now();
    this.ctx.db.transaction(() => {
      this.ctx.db.scenes.update(
        sceneId,
        { narrationText: plan.proposedNarration as string },
        now,
      );
      this.ctx.db.plans.put({
        ...plan,
        claims: [...new Set([...plan.claims, ...claims])].slice(0, 20),
        proposedNarration: null,
        proposalJobId: null,
        updatedAt: now,
      });
    });
    return this.ctx.db.scenes.get(sceneId) as Scene;
  }

  async preflight(episodeId: string): Promise<PreflightReport> {
    const blueprint = await this.get(episodeId);
    const settings = getSettings(this.ctx);
    const issues: PreflightIssue[] = [];
    const add = (
      level: PreflightIssue["level"],
      code: string,
      message: string,
      sceneId: string | null = null,
    ) =>
      issues.push({
        id: `${code}-${issues.length + 1}`,
        level,
        code,
        message,
        sceneId,
      });
    const methods = new Map(
      blueprint.methods.map((method) => [method.method, method]),
    );
    const scenes = this.ctx.db.scenes.listForEpisode(episodeId);
    const assets = this.ctx.db.assets.getMany(
      scenes.flatMap((scene) =>
        [scene.imageAssetId, scene.videoAssetId, scene.audioAssetId].filter(
          (id): id is string => id !== null,
        ),
      ),
    );

    if (blueprint.scenes.length === 0)
      add("blocking", "no-scenes", "The episode has no scenes.");
    const renderer =
      blueprint.methods.find((method) => method.method === "static-image")
        ?.engines ?? [];
    if (!renderer.some((engine) => engine.available)) {
      add(
        "pending",
        "renderer-unavailable",
        "The renderer is not available, so the episode cannot be rendered yet. Set up rendering in Settings.",
      );
    }
    if (
      !["1920x1080", "1280x720", "1080x1920"].includes(
        settings.exportResolution,
      ) ||
      ![24, 25, 30].includes(settings.exportFps)
    ) {
      add(
        "blocking",
        "output-settings",
        `The renderer does not support ${settings.exportResolution} at ${settings.exportFps} fps.`,
      );
    }

    for (const item of blueprint.scenes) {
      const scene = scenes.find(
        (candidate) => candidate.id === item.sceneId,
      ) as Scene;
      const name = `Scene ${item.index + 1}${item.title ? ` ("${item.title}")` : ""}`;
      const plan = item.plan;
      const needed = METHOD_MEDIA[plan.method];
      const hasMedia =
        needed === "animation"
          ? plan.animation !== null
          : needed === "image"
            ? item.media.image || item.media.video
            : item.media.video;

      // Files the scene refers to must exist.
      for (const [slot, id] of [
        ["image", scene.imageAssetId],
        ["video", scene.videoAssetId],
        ["audio", scene.audioAssetId],
      ] as const) {
        if (!id) continue;
        const asset = assets.get(id);
        const reachable = asset
          ? await access(
              resolveMediaPath(this.ctx.paths.mediaRoot, asset.relativePath),
            ).then(
              () => true,
              () => false,
            )
          : false;
        if (!reachable)
          add(
            "blocking",
            "missing-asset-file",
            `${name}: its ${slot} file is missing from the library. Import it again.`,
            item.sceneId,
          );
      }

      const method = methods.get(plan.method);
      if (!hasMedia) {
        if (!method?.available) {
          add(
            "blocking",
            "unsupported-method",
            `${name}: ${PRODUCTION_METHOD_LABELS[plan.method]} cannot be made: ${method?.reason ?? "no engine"} Import the media or choose another method.`,
            item.sceneId,
          );
        } else if (needed === "animation") {
          add(
            "pending",
            "animation-to-configure",
            `${name}: choose the animation it is drawn from.`,
            item.sceneId,
          );
        } else if (METHOD_TASK[plan.method]) {
          const task = METHOD_TASK[plan.method] as
            "image_generation" | "video_generation";
          const engine = plan.engineId
            ? method.engines.find((candidate) => candidate.id === plan.engineId)
            : method.engines.find((candidate) => candidate.available);
          if (plan.engineId && (!engine || !engine.available)) {
            add(
              "blocking",
              "unsupported-engine",
              `${name}: the chosen engine (${plan.engineId}) is not available${engine?.reason ? `: ${engine.reason}` : "."}`,
              item.sceneId,
            );
          } else if (engine) {
            if (engine.maturity === "experimental") {
              add(
                "editorial",
                "experimental-engine",
                `${name}: ${engine.name} is experimental; its results have not been confirmed by a real run in Framebop.`,
                item.sceneId,
              );
            }
            if (plan.model) {
              const choices = await this.models.choices(task, engine.id);
              const choice = choices.find(
                (candidate) =>
                  candidate.reference === plan.model ||
                  candidate.modelId === plan.model ||
                  candidate.key === plan.model,
              );
              if (!choice?.usable) {
                add(
                  "blocking",
                  "incompatible-model",
                  `${name}: the chosen model cannot be used with ${engine.name}${choice ? `: ${choice.reason}` : "."}`,
                  item.sceneId,
                );
              }
            }
            if (plan.method === "image-to-video" && !item.media.image) {
              add(
                "pending",
                "needs-input-image",
                `${name}: needs a still image to animate first.`,
                item.sceneId,
              );
            }
          }
          add(
            "pending",
            "media-to-generate",
            `${name}: its ${needed} is still to be generated.`,
            item.sceneId,
          );
        } else {
          add(
            "pending",
            "media-to-import",
            `${name}: its ${needed} is still to be imported${plan.requiredAssets.length > 0 ? ` (needed: ${plan.requiredAssets.join("; ")})` : ""}.`,
            item.sceneId,
          );
        }
      }

      if (!item.narrationText.trim()) {
        add(
          "editorial",
          "no-narration",
          `${name} has no narration.`,
          item.sceneId,
        );
      } else if (!item.media.audio) {
        add(
          "pending",
          "narration-audio",
          `${name}: its narration audio is still to be produced.`,
          item.sceneId,
        );
      }
      if (!item.visualDescription.trim() && !hasMedia) {
        add(
          "editorial",
          "incomplete-plan",
          `${name} has no visual description yet.`,
          item.sceneId,
        );
      }
      const measured = item.narration.measuredSeconds;
      if (measured !== null && measured > item.durationSeconds + 0.5) {
        add(
          "blocking",
          "narration-too-long",
          `${name}: its narration audio lasts ${measured.toFixed(1)} s but the scene ${item.durationSeconds.toFixed(1)} s, so it would be cut off. Use the measured length or shorten the narration.`,
          item.sceneId,
        );
      } else if (measured !== null && measured < item.durationSeconds * 0.7) {
        add(
          "editorial",
          "duration-mismatch",
          `${name}: the scene lasts ${item.durationSeconds.toFixed(1)} s but its narration ${measured.toFixed(1)} s.`,
          item.sceneId,
        );
      } else if (measured === null && item.narration.words > 0) {
        const estimate = item.narration.estimatedSeconds;
        if (
          Math.abs(estimate - item.durationSeconds) >
          Math.max(2, item.durationSeconds * 0.35)
        ) {
          add(
            "editorial",
            "duration-mismatch",
            `${name}: planned for ${item.durationSeconds.toFixed(1)} s, but its narration is estimated at ${estimate.toFixed(1)} s (no audio yet).`,
            item.sceneId,
          );
        }
      }
      if (plan.claims.length > 0) {
        add(
          "editorial",
          "unverified-claims",
          `${name} states facts to check in independent sources: ${plan.claims.join(" · ")}`,
          item.sceneId,
        );
      }
      if (plan.research.length > 0) {
        add(
          "editorial",
          "reference-research",
          `${name} draws on research about a reference video, which is not verification.`,
          item.sceneId,
        );
      }
    }
    const ratio =
      blueprint.plannedSeconds / Math.max(1, blueprint.targetSeconds);
    if (blueprint.scenes.length > 0 && (ratio < 0.85 || ratio > 1.15)) {
      add(
        "editorial",
        "project-duration",
        `The scenes add up to ${formatClock(blueprint.plannedSeconds)} against the project's target of ${formatClock(blueprint.targetSeconds)}.`,
      );
    }
    const blocking = issues.some((issue) => issue.level === "blocking");
    return {
      checkedAt: this.ctx.now(),
      readyToProduce: !blocking,
      readyToRender:
        !blocking && !issues.some((issue) => issue.level === "pending"),
      issues,
    };
  }
}
