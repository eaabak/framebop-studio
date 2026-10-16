/**
 * Story Architect: story drafts developed from Video DNA concepts, their
 * generation with the local language model, and the hand-off to a
 * production project.
 *
 * Generation runs as a job in the production lane (never beside a video
 * job), loads the model once for all its steps, saves after every step and
 * unloads afterwards. While it runs, the draft cannot be edited, so a user's
 * changes and the generator's never meet. Approved scenes are never
 * replaced. Nothing reaches the production projects until the user confirms,
 * and then everything is written in one transaction, once.
 */
import {
  AppError,
  type Episode,
  type Job,
  type Project,
  type ResearchAnalysis,
  type RpcParsedParams,
  type Scene,
  type StoryDraft,
  type StoryDraftSummary,
  type StoryEditable,
  type StoryGeneration,
  type StoryScene,
  type StoryScope,
  conceptHandoff,
  wordBudget,
  formatClock,
  sceneSeconds,
  toErrorShape,
} from "@framebop/core";
import type { StoredStoryDraft } from "@framebop/database";
import {
  type StoryReference,
  type StoryRun,
  expandScene,
  generateOutline,
  generateSectionScenes,
  mergeSectionScenes,
  regenerateScene,
  reviewStory,
  storySeconds,
} from "@framebop/research";
import type { EngineContext } from "../context";
import type { AnalysisService } from "./analysis";
import type { JobExecutor, JobQueue } from "./jobs";
import { type LocalLlmService, runtimeLabel } from "./llm";
import { type BlueprintService, defaultPlan } from "./blueprint";
import { getSettings } from "./settings";

const ACTIVE = new Set([
  "queued",
  "loading-model",
  "outline",
  "scenes",
  "validating",
]);

const IDLE: StoryGeneration = {
  status: "idle",
  scope: null,
  jobId: null,
  modelId: null,
  runtime: null,
  step: null,
  problems: [],
  model: null,
  error: null,
  startedAt: null,
  finishedAt: null,
};

function scopeLabel(scope: StoryScope): string {
  return scope.kind === "outline"
    ? "outline"
    : scope.kind === "script"
      ? "script"
      : scope.kind === "section"
        ? "one section"
        : scope.kind === "expand"
          ? "lengthen a section"
          : "one scene";
}

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

export class StoryService {
  constructor(
    private readonly ctx: EngineContext,
    private readonly jobs: JobQueue,
    private readonly llm: LocalLlmService,
    private readonly analyses: AnalysisService,
  ) {}

  /** Generation that was running when the application stopped is interrupted. */
  recover(): void {
    for (const draft of this.ctx.db.stories.running()) {
      this.write(draft, {
        generation: {
          ...draft.generation,
          status: "interrupted",
          step: null,
          error:
            "Framebop stopped while this was being generated. Finished steps were kept.",
          finishedAt: this.ctx.now(),
        },
      });
    }
  }

  private require(id: string): StoredStoryDraft {
    const draft = this.ctx.db.stories.get(id);
    if (!draft)
      throw new AppError("NOT_FOUND", "That story draft no longer exists.");
    return draft;
  }

  private write(
    draft: StoredStoryDraft,
    changes: Partial<StoredStoryDraft>,
  ): StoredStoryDraft {
    const next: StoredStoryDraft = {
      ...draft,
      ...changes,
      revision: draft.revision + 1,
      updatedAt: this.ctx.now(),
    };
    this.ctx.db.stories.save(next);
    return next;
  }

  private reference(referenceVideoId: string): StoryReference {
    const db = this.ctx.db.research;
    const snapshot = db.listSnapshots(referenceVideoId)[0];
    const transcripts = db.listTranscripts(referenceVideoId);
    return {
      title: snapshot?.metadata.title ?? "",
      description: snapshot?.metadata.description ?? "",
      segments: transcripts.flatMap((transcript) => db.segments(transcript.id)),
    };
  }

  /** The stored draft with its job's outcome, review and estimates applied. */
  present(stored: StoredStoryDraft): StoryDraft {
    let draft = stored;
    const generation = stored.generation;
    if (ACTIVE.has(generation.status) && generation.jobId) {
      const job = this.ctx.db.jobs.get(generation.jobId);
      if (job && ["cancelled", "failed", "interrupted"].includes(job.status)) {
        draft = this.write(stored, {
          generation: {
            ...generation,
            status: job.status as StoryGeneration["status"],
            step: null,
            error: generation.error ?? job.error?.message ?? null,
            finishedAt: job.finishedAt,
          },
        });
      }
    }
    const videoExists =
      this.ctx.db.research.getVideo(draft.referenceVideoId) !== null;
    const sourceChanged =
      videoExists &&
      this.analyses.fingerprint(draft.referenceVideoId) !==
        draft.sourceFingerprint;
    return {
      ...draft,
      sourceChanged,
      estimatedSeconds: storySeconds(
        draft.scenes,
        draft.settings.wordsPerMinute,
      ),
      warnings: reviewStory({
        settings: draft.settings,
        outline: draft.outline,
        scenes: draft.scenes,
        reference: videoExists
          ? this.reference(draft.referenceVideoId)
          : { title: "", description: "", segments: [] },
        sourceChanged,
        modelProblems: draft.generation.problems,
        model: draft.generation.model,
      }),
    };
  }

  get(id: string): StoryDraft {
    return this.present(this.require(id));
  }

  list(researchProjectId: string): StoryDraftSummary[] {
    return this.ctx.db.stories.list(researchProjectId).map((draft) => ({
      id: draft.id,
      referenceVideoId: draft.referenceVideoId,
      revision: draft.revision,
      estimatedSeconds: storySeconds(
        draft.scenes,
        draft.settings.wordsPerMinute,
      ),
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
      title: draft.settings.title,
      sceneCount: draft.scenes.length,
      status: draft.generation.status,
      productionProjectId: draft.handoff?.productionProjectId ?? null,
    }));
  }

  /** A draft for a concept from a saved analysis. Reuses an open one. */
  create({ analysisId, itemId }: RpcParsedParams<"story.create">): StoryDraft {
    const analysis: ResearchAnalysis = this.analyses.get(analysisId);
    const item = analysis.sections
      .flatMap((section) => section.items)
      .find((entry) => entry.id === itemId);
    const concept = item ? conceptHandoff(analysisId, item) : null;
    if (!concept)
      throw new AppError("NOT_FOUND", "That concept is not in the analysis.");
    const existing = this.ctx.db.stories.findOpen(analysisId, itemId);
    if (existing) return this.present(existing);

    const language = this.ctx.db.research.listSnapshots(
      analysis.referenceVideoId,
    )[0]?.metadata.defaultAudioLanguage;
    const now = this.ctx.now();
    const draft: StoredStoryDraft = {
      id: this.ctx.newId(),
      researchProjectId: analysis.projectId,
      referenceVideoId: analysis.referenceVideoId,
      concept: {
        analysisId,
        itemId,
        title: concept.title,
        premise: concept.premise,
        angle: concept.angle,
        audience: concept.audience,
        durationMinutes: concept.durationMinutes,
        visualDirection: concept.visualDirection,
        researchNeeded: concept.researchNeeded,
        evidence: concept.evidence,
      },
      settings: {
        title: clip(concept.title, 120),
        targetDurationSeconds: Math.min(
          7200,
          Math.max(30, Math.round((concept.durationMinutes ?? 8) * 60)),
        ),
        language: language?.split("-")[0] ?? "en",
        audience: clip(concept.audience, 300),
        tone: "",
        visualDirection: clip(concept.visualDirection, 500),
        narrationStyle: "",
        sceneCount: null,
        wordsPerMinute: getSettings(this.ctx).narrationWordsPerMinute,
      },
      outline: null,
      scenes: [],
      revision: 0,
      sourceFingerprint: analysis.inputFingerprint,
      generation: IDLE,
      handoff: null,
      createdAt: now,
      updatedAt: now,
    };
    this.ctx.db.stories.insert(draft);
    this.ctx.log
      .scope("story")
      .info("Created story draft", { draftId: draft.id, analysisId });
    return this.present(draft);
  }

  private guardIdle(draft: StoredStoryDraft): void {
    if (ACTIVE.has(this.present(draft).generation.status)) {
      throw new AppError(
        "CONFLICT",
        "The draft is being generated. Wait for it to finish, or cancel it.",
      );
    }
  }

  private guardRevision(draft: StoredStoryDraft, baseRevision: number): void {
    if (draft.revision !== baseRevision) {
      throw new AppError(
        "CONFLICT",
        "The draft changed since you opened it. Reload it to see the latest version.",
      );
    }
  }

  /** Saves the user's edits as a new revision. */
  save({
    id,
    baseRevision,
    draft: edits,
  }: RpcParsedParams<"story.save">): StoryDraft {
    const stored = this.require(id);
    this.guardIdle(stored);
    this.guardRevision(stored, baseRevision);
    const ids = edits.scenes.map((scene) => scene.id);
    if (new Set(ids).size !== ids.length)
      throw new AppError("VALIDATION", "Two scenes have the same id.");
    const before = new Map(stored.scenes.map((scene) => [scene.id, scene]));
    // An AI scene the user changed is marked as edited.
    const scenes = edits.scenes.map((scene): StoryScene => {
      const previous = before.get(scene.id);
      const changed =
        previous !== undefined &&
        (previous.narrationText !== scene.narrationText ||
          previous.title !== scene.title ||
          previous.visualDescription !== scene.visualDescription);
      return previous?.origin === "ai" && changed
        ? { ...scene, origin: "ai-edited" }
        : scene;
    });
    return this.present(
      this.write(stored, {
        settings: edits.settings,
        outline: edits.outline,
        scenes,
      }),
    );
  }

  async generate({
    id,
    modelId,
    scope,
  }: RpcParsedParams<"story.generate">): Promise<StoryDraft> {
    const stored = this.require(id);
    this.guardIdle(stored);
    if (scope.kind !== "outline" && !stored.outline) {
      throw new AppError("VALIDATION", "Generate or write an outline first.");
    }
    if (
      scope.kind === "expand" &&
      !stored.outline?.sections.some(
        (section) => section.id === scope.sectionId,
      )
    ) {
      throw new AppError(
        "NOT_FOUND",
        "That section is no longer in the outline.",
      );
    }
    if (
      scope.kind === "section" &&
      !stored.outline?.sections.some(
        (section) => section.id === scope.sectionId,
      )
    ) {
      throw new AppError(
        "NOT_FOUND",
        "That section is no longer in the outline.",
      );
    }
    if (scope.kind === "scene") {
      const scene = stored.scenes.find((item) => item.id === scope.sceneId);
      if (!scene)
        throw new AppError(
          "NOT_FOUND",
          "That scene is no longer in the draft.",
        );
      if (scene.approved)
        throw new AppError(
          "CONFLICT",
          "That scene is approved. Unapprove it to write it again.",
        );
    }
    // Refuse now, with the exact reason, rather than fail in the queue.
    await this.llm.prepare(modelId);
    const job = this.jobs.submit({
      type: "story_generation",
      label: `Story draft: ${stored.settings.title} (${scopeLabel(scope)})`,
      adapterId: "llama.cpp",
      model: modelId,
      projectId: null,
      episodeId: null,
      sceneId: null,
      slot: null,
      input: { draftId: id, scope },
    });
    // The queue may already have started it; then it has written its state.
    const latest = this.require(id);
    if (latest.generation.jobId === job.id) return this.present(latest);
    return this.present(
      this.write(latest, {
        generation: {
          ...IDLE,
          status: "queued",
          scope,
          jobId: job.id,
          modelId,
        },
      }),
    );
  }

  cancel(id: string): StoryDraft {
    const draft = this.require(id);
    if (ACTIVE.has(draft.generation.status) && draft.generation.jobId) {
      this.jobs.cancel(draft.generation.jobId);
    }
    return this.get(id);
  }

  delete(id: string): void {
    this.guardIdle(this.require(id));
    this.ctx.db.stories.delete(id);
  }

  /** Must be set before suggestions for production scenes can be made. */
  blueprint: BlueprintService | null = null;

  /**
   * Queues a longer narration for one production scene, as a suggestion the
   * user accepts or discards in the Blueprint. The scene is not changed.
   */
  async suggestNarration({
    sceneId,
    modelId,
  }: {
    sceneId: string;
    modelId: string;
  }): Promise<Job> {
    const scene = this.ctx.db.scenes.get(sceneId);
    if (!scene) throw new AppError("NOT_FOUND", "That scene no longer exists.");
    if (!scene.narrationText.trim())
      throw new AppError(
        "VALIDATION",
        "Write some narration first; a suggestion lengthens what is there.",
      );
    const plan = this.ctx.db.plans.get(sceneId);
    const pending = plan?.proposalJobId
      ? this.ctx.db.jobs.get(plan.proposalJobId)
      : null;
    if (pending && ["pending", "running"].includes(pending.status)) {
      throw new AppError(
        "CONFLICT",
        "A suggestion for this scene is already being written.",
      );
    }
    await this.llm.prepare(modelId);
    const job = this.jobs.submit({
      type: "story_generation",
      label: `Longer narration: ${scene.title || "scene"}`,
      adapterId: "llama.cpp",
      model: modelId,
      projectId: null,
      episodeId: scene.episodeId,
      sceneId: null,
      slot: null,
      input: { kind: "scene-narration", sceneId },
    });
    if (this.ctx.db.plans.get(sceneId)?.proposalJobId !== job.id) {
      this.blueprint?.setProposal(sceneId, null, job.id);
    }
    return this.ctx.db.jobs.get(job.id) ?? job;
  }

  private async narrationJob(
    job: Job,
    control: Parameters<JobExecutor["run"]>[1],
  ) {
    const sceneId = String(job.input.sceneId ?? "");
    const scene = this.ctx.db.scenes.get(sceneId);
    if (!scene) throw new AppError("NOT_FOUND", "The scene was deleted.");
    this.blueprint?.setProposal(sceneId, null, job.id);
    const episode = this.ctx.db.episodes.get(scene.episodeId) as Episode;
    const project = this.ctx.db.projects.get(episode.projectId) as Project;
    const plans = this.ctx.db.plans.forEpisode(episode.id);
    const draftId = [...plans.values()].find(
      (plan) => plan.storyDraftId,
    )?.storyDraftId;
    const draft = draftId ? this.ctx.db.stories.get(draftId) : null;
    const settings = draft?.settings ?? {
      title: project.name,
      targetDurationSeconds: Math.min(
        7200,
        Math.max(30, project.targetDurationSeconds),
      ),
      language: project.language,
      audience: "",
      tone: "",
      visualDirection: project.visualStyle,
      narrationStyle: "",
      sceneCount: null,
      wordsPerMinute: getSettings(this.ctx).narrationWordsPerMinute,
    };
    const concept = draft?.concept ?? {
      analysisId: project.id,
      itemId: "",
      title: project.name,
      premise: project.description || project.name,
      angle: "",
      audience: "",
      durationMinutes: null,
      visualDirection: project.visualStyle,
      researchNeeded: [],
      evidence: [],
    };
    const productionScenes = this.ctx.db.scenes.listForEpisode(episode.id);
    const scenes: StoryScene[] = productionScenes.map((item) => ({
      id: item.id,
      sectionId: "episode",
      title: item.title,
      narrationText: item.narrationText,
      visualDescription: item.imagePrompt,
      animationApproach: item.motionPrompt,
      cameraMotion: item.cameraMotion,
      cameraInstructions: item.cameraInstructions,
      overlayText: item.overlayText,
      transition: item.transition,
      productionNotes: "",
      missingAssets: [],
      claims: plans.get(item.id)?.claims ?? [],
      researchRefs: [],
      plannedSeconds: null,
      approved: false,
      origin: "ai",
    }));
    const outline = {
      hook: "",
      premise: draft?.outline?.premise ?? (project.description || project.name),
      centralQuestions: [],
      ending: "",
      sections: [
        {
          id: "episode",
          title: episode.title,
          purpose: project.description || episode.title,
          keyPoints: [],
          examples: [],
          targetSeconds: Math.max(
            5,
            Math.min(
              3600,
              productionScenes.reduce(
                (sum, item) => sum + item.durationSeconds,
                0,
              ),
            ),
          ),
        },
      ],
    };
    const words = scene.narrationText
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
    const target = Math.max(
      Math.round(words * 1.3),
      wordBudget(scene.durationSeconds, settings.wordsPerMinute),
    );
    control.reportProgress(null, "Writing a longer narration");
    const result = await this.llm.withModel(
      String(job.model),
      control.signal,
      (provider) =>
        expandScene(
          {
            concept,
            settings,
            generator: provider,
            newId: () => this.ctx.newId(),
            signal: control.signal,
          },
          outline,
          scenes,
          sceneId,
          target,
        ),
    );
    if ("problem" in result)
      throw new AppError("ENGINE_FAILURE", result.problem);
    this.blueprint?.setProposal(sceneId, result.narration, job.id);
    return {
      output: {
        sceneId,
        claims: result.claims.filter(
          (claim) => !(plans.get(sceneId)?.claims ?? []).includes(claim),
        ),
      },
    };
  }

  executor(): JobExecutor {
    return {
      canCancel: () => true,
      run: async (job, control) => {
        if (job.input.kind === "scene-narration")
          return this.narrationJob(job, control);
        const draftId = String(job.input.draftId ?? "");
        const scope = job.input.scope as StoryScope;
        let draft = this.require(draftId);
        const problems: string[] = [];
        const update = (
          changes: Partial<StoredStoryDraft>,
          step?: string | null,
        ) => {
          draft = this.require(draftId);
          draft = this.write(draft, {
            ...changes,
            generation: {
              ...draft.generation,
              ...(changes.generation ?? {}),
              ...(step !== undefined ? { step } : {}),
              problems,
            },
          });
        };
        update(
          {
            generation: {
              ...draft.generation,
              status: "loading-model",
              jobId: job.id,
              scope,
              startedAt: this.ctx.now(),
              finishedAt: null,
              error: null,
            },
          },
          "Loading the language model",
        );
        control.reportProgress(null, "Loading the language model");
        try {
          const prepared = await this.llm.prepare(String(job.model));
          update({
            generation: {
              ...draft.generation,
              model: { name: prepared.ref.name, longForm: prepared.longForm },
            },
          });
          await this.llm.withModel(
            String(job.model),
            control.signal,
            async (provider, runtime) => {
              const run: StoryRun = {
                concept: draft.concept,
                settings: draft.settings,
                generator: provider,
                newId: () => this.ctx.newId(),
                signal: control.signal,
              };
              update({
                generation: {
                  ...draft.generation,
                  runtime: runtimeLabel(runtime),
                },
              });
              if (scope.kind === "outline") {
                update(
                  { generation: { ...draft.generation, status: "outline" } },
                  "Planning the outline",
                );
                control.reportProgress(null, "Planning the outline");
                const result = await generateOutline(run);
                problems.push(...result.problems);
                if (!result.outline)
                  throw new AppError(
                    "ENGINE_FAILURE",
                    `No usable outline: ${result.problems.join(" ")}`,
                  );
                // Unapproved scenes belonged to the old outline; approved ones stay.
                update({
                  outline: result.outline,
                  scenes: draft.scenes.filter((scene) => scene.approved),
                });
              } else if (scope.kind === "scene") {
                update(
                  { generation: { ...draft.generation, status: "scenes" } },
                  "Writing the scene",
                );
                const outline = draft.outline as NonNullable<
                  StoredStoryDraft["outline"]
                >;
                const result = await regenerateScene(
                  run,
                  outline,
                  draft.scenes,
                  scope.sceneId,
                );
                problems.push(...result.problems);
                const fresh = result.scene;
                if (!fresh)
                  throw new AppError(
                    "ENGINE_FAILURE",
                    `The scene was not rewritten: ${result.problems.join(" ")}`,
                  );
                const current = this.require(draftId).scenes;
                update({
                  scenes: current.map((scene) =>
                    scene.id === fresh.id && !scene.approved ? fresh : scene,
                  ),
                });
              } else if (scope.kind === "expand") {
                const outline = draft.outline as NonNullable<
                  StoredStoryDraft["outline"]
                >;
                const section = outline.sections.find(
                  (item) => item.id === scope.sectionId,
                );
                if (!section)
                  throw new AppError(
                    "NOT_FOUND",
                    "That section is no longer in the outline.",
                  );
                const inSection = draft.scenes.filter(
                  (scene) => scene.sectionId === section.id,
                );
                const budget = Math.max(
                  25,
                  Math.round(
                    wordBudget(
                      section.targetSeconds,
                      draft.settings.wordsPerMinute,
                    ) / Math.max(1, inSection.length),
                  ),
                );
                for (const scene of inSection) {
                  if (control.signal.aborted)
                    throw new AppError(
                      "CANCELLED",
                      "Generation was cancelled.",
                    );
                  if (scene.approved) continue;
                  if (scene.origin !== "ai") {
                    problems.push(
                      `Scene "${scene.title}" was left as you wrote it.`,
                    );
                    continue;
                  }
                  const words = scene.narrationText
                    .trim()
                    .split(/\s+/)
                    .filter(Boolean).length;
                  if (words >= budget * 0.85) continue;
                  update(
                    { generation: { ...draft.generation, status: "scenes" } },
                    `Lengthening "${scene.title}"`,
                  );
                  const result = await expandScene(
                    run,
                    outline,
                    this.require(draftId).scenes,
                    scene.id,
                    budget,
                  );
                  if ("problem" in result) {
                    problems.push(result.problem);
                    continue;
                  }
                  // Saved after every scene.
                  update({
                    scenes: this.require(draftId).scenes.map((item) =>
                      item.id === scene.id &&
                      !item.approved &&
                      item.origin === "ai"
                        ? {
                            ...item,
                            narrationText: result.narration,
                            claims: result.claims,
                          }
                        : item,
                    ),
                  });
                }
              } else {
                const outline = draft.outline as NonNullable<
                  StoredStoryDraft["outline"]
                >;
                const sections = outline.sections.filter((section) =>
                  scope.kind === "section"
                    ? section.id === scope.sectionId
                    : !draft.scenes.some(
                        (scene) => scene.sectionId === section.id,
                      ),
                );
                for (const [index, section] of sections.entries()) {
                  if (control.signal.aborted)
                    throw new AppError(
                      "CANCELLED",
                      "Generation was cancelled.",
                    );
                  const step = `Section ${index + 1} of ${sections.length}: ${section.title}`;
                  update(
                    { generation: { ...draft.generation, status: "scenes" } },
                    step,
                  );
                  control.reportProgress(index / sections.length, step);
                  const result = await generateSectionScenes(
                    run,
                    outline,
                    section,
                    this.require(draftId).scenes,
                    // Each scene is saved as soon as it is written.
                    (written) =>
                      update(
                        {
                          scenes: mergeSectionScenes(
                            this.require(draftId).scenes,
                            outline,
                            section.id,
                            written,
                          ),
                        },
                        `${step} (scene ${written.length})`,
                      ),
                  );
                  problems.push(...result.problems);
                  if (control.signal.aborted)
                    throw new AppError(
                      "CANCELLED",
                      "Generation was cancelled.",
                    );
                }
              }
              update(
                { generation: { ...draft.generation, status: "validating" } },
                "Reviewing the draft",
              );
              control.reportProgress(1, "Reviewing the draft");
            },
          );
        } catch (error) {
          const shape = toErrorShape(error);
          const cancelled =
            control.signal.aborted || shape.code === "CANCELLED";
          update(
            {
              generation: {
                ...draft.generation,
                status: cancelled ? "cancelled" : "failed",
                error: cancelled ? null : shape.message,
                finishedAt: this.ctx.now(),
              },
            },
            null,
          );
          throw error;
        }
        update(
          {
            generation: {
              ...draft.generation,
              status: "completed",
              finishedAt: this.ctx.now(),
            },
          },
          null,
        );
        return {
          output: { draftId, scenes: draft.scenes.length },
          metadata: { problems: problems.length },
        };
      },
    };
  }

  /**
   * Creates the production project from a reviewed draft: one project, one
   * episode in draft state and its scenes, in a single transaction. Asking
   * again returns the project already created.
   */
  createProject({ id, baseRevision }: RpcParsedParams<"story.createProject">): {
    draft: StoryDraft;
    projectId: string;
    episodeId: string;
    created: boolean;
  } {
    const db = this.ctx.db;
    const result = db.transaction(() => {
      const stored = this.require(id);
      if (
        stored.handoff &&
        db.projects.get(stored.handoff.productionProjectId)
      ) {
        return {
          projectId: stored.handoff.productionProjectId,
          episodeId: stored.handoff.episodeId,
          created: false,
        };
      }
      this.guardIdle(stored);
      this.guardRevision(stored, baseRevision);
      const draft = this.present(stored);
      const blocking = draft.warnings.filter(
        (warning) => warning.severity === "blocking",
      );
      if (blocking.length > 0) {
        throw new AppError(
          "VALIDATION",
          `Fix these first: ${blocking.map((warning) => warning.message).join(" ")}`,
        );
      }
      const now = this.ctx.now();
      const { settings, concept } = draft;
      const project: Project = {
        id: this.ctx.newId(),
        name: settings.title,
        description: clip(
          `${draft.outline?.premise ?? concept.premise}\n\nDeveloped in Video DNA Lab from the concept "${concept.title}" (story draft revision ${draft.revision}). Its scenes are drafts: no images, video or narration have been produced. Facts in the narration still need checking in independent sources.`,
          2000,
        ),
        targetDurationSeconds: settings.targetDurationSeconds,
        language: settings.language,
        visualStyle: clip(settings.visualDirection, 500),
        createdAt: now,
        updatedAt: now,
      };
      const episode: Episode = {
        id: this.ctx.newId(),
        projectId: project.id,
        sequenceIndex: 0,
        title: settings.title,
        script: draft.scenes
          .map(
            (scene) =>
              `## ${scene.title || "Untitled scene"}\n\n${scene.narrationText}`,
          )
          .join("\n\n"),
        productionState: "draft",
        musicAssetId: null,
        musicVolume: 0.15,
        createdAt: now,
        updatedAt: now,
      };
      db.projects.insert(project);
      db.episodes.insert(episode);
      const fallback = getSettings(this.ctx).defaultSceneDurationSeconds;
      const mapping = draft.scenes.map((scene, index) => {
        const notes = [
          scene.visualDescription,
          "Draft scene from Story Architect.",
          scene.productionNotes && `Production notes: ${scene.productionNotes}`,
          scene.missingAssets.length > 0 &&
            `Needed: ${scene.missingAssets.join("; ")}`,
          scene.claims.length > 0 &&
            `Check before production: ${scene.claims.join("; ")}`,
          scene.researchRefs.length > 0 &&
            `Research (reference material, not verification): ${scene.researchRefs.map((ref) => `${ref.kind}${ref.locator ? ` ${ref.locator}` : ""}`).join("; ")}`,
        ].filter(Boolean);
        const record: Scene = {
          id: this.ctx.newId(),
          episodeId: episode.id,
          sequenceIndex: index,
          title: clip(scene.title, 160),
          description: clip(notes.join("\n\n"), 2000),
          durationSeconds: sceneSeconds(
            scene,
            settings.wordsPerMinute,
            fallback,
          ),
          narrationText: scene.narrationText,
          imagePrompt: clip(scene.visualDescription, 4000),
          motionPrompt: clip(scene.animationApproach, 4000),
          cameraMotion: scene.cameraMotion,
          cameraInstructions: scene.cameraInstructions,
          animationEngine: null,
          transition: scene.transition,
          overlayText: scene.overlayText,
          overlayPosition: "bottom",
          imageAssetId: null,
          videoAssetId: null,
          audioAssetId: null,
          generationState: "idle",
          createdAt: now,
          updatedAt: now,
        };
        db.scenes.insert(record);
        // The scene's production plan starts from what the draft knew.
        db.plans.put({
          ...defaultPlan(record, now),
          requiredAssets: scene.missingAssets,
          claims: scene.claims,
          research: scene.researchRefs,
          durationSource: scene.plannedSeconds !== null ? "manual" : "estimate",
          storyDraftId: draft.id,
          draftSceneId: scene.id,
        });
        return { draftSceneId: scene.id, sceneId: record.id };
      });
      this.write(stored, {
        handoff: {
          productionProjectId: project.id,
          episodeId: episode.id,
          scenes: mapping,
          revision: stored.revision,
          createdAt: now,
        },
      });
      this.ctx.log
        .scope("story")
        .info("Created production project from a story draft", {
          draftId: id,
          projectId: project.id,
          scenes: mapping.length,
          estimated: formatClock(draft.estimatedSeconds),
        });
      return { projectId: project.id, episodeId: episode.id, created: true };
    });
    return { ...result, draft: this.get(id) };
  }
}
