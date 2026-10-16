/**
 * Video DNA analyses: the six AI analyses of a reference video, run as a job
 * in the production lane with the local language model.
 *
 * Queued → Loading model → Analyzing (one section at a time, each saved as it
 * finishes) → Validating → Completed, Failed or Cancelled. The model is
 * unloaded afterwards whatever happens. An analysis records a fingerprint of
 * the research data it read, and is shown as stale once that data changes.
 */
import { createHash } from "node:crypto";
import {
  ANALYSIS_TASKS,
  type AnalysisSection,
  type AnalysisTask,
  AppError,
  type ResearchAnalysis,
  type Transcript,
  toErrorShape,
} from "@framebop/core";
import {
  DEFAULT_ANALYZER_OPTIONS,
  type EvidenceBundle,
  PLANNED_ANALYSES,
  runAnalyzer,
} from "@framebop/research";
import type { EngineContext } from "../context";
import type { JobExecutor, JobQueue } from "./jobs";
import { type LocalLlmService, runtimeLabel } from "./llm";

const TERMINAL = new Set(["completed", "failed", "cancelled", "interrupted"]);

export class AnalysisService {
  constructor(
    private readonly ctx: EngineContext,
    private readonly jobs: JobQueue,
    private readonly llm: LocalLlmService,
  ) {}

  /** Marks analyses left running by a previous session as interrupted. */
  recover(): void {
    this.ctx.db.research.interruptUnfinishedAnalyses(this.ctx.now());
  }

  private bundle(referenceVideoId: string): {
    bundle: EvidenceBundle;
    fingerprint: string;
  } {
    const db = this.ctx.db.research;
    const snapshot = db.listSnapshots(referenceVideoId)[0] ?? null;
    const sample = db.getSample(referenceVideoId);
    const transcripts: Transcript[] = db.listTranscripts(referenceVideoId);
    const bundle: EvidenceBundle = {
      snapshot,
      comments: sample ? db.allComments(sample.id) : [],
      transcripts: transcripts.map((transcript) => ({
        transcript,
        segments: db.segments(transcript.id),
      })),
      commentSampleId: sample?.id ?? null,
      commentsRetrievedAt: sample?.updatedAt ?? null,
    };
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          snapshot: snapshot?.id ?? null,
          sample: sample
            ? [sample.id, sample.storedCount, sample.updatedAt]
            : null,
          transcripts: transcripts.map((item) => item.id),
        }),
      )
      .digest("hex");
    return { bundle, fingerprint };
  }

  /** Identifies the research data stored for a video right now. */
  fingerprint(referenceVideoId: string): string {
    return this.bundle(referenceVideoId).fingerprint;
  }

  /** The stored analysis, with its job's outcome and staleness applied. */
  private present(stored: Omit<ResearchAnalysis, "stale">): ResearchAnalysis {
    let analysis = stored;
    if (!TERMINAL.has(stored.status) && stored.jobId) {
      const job = this.ctx.db.jobs.get(stored.jobId);
      if (job && ["cancelled", "failed", "interrupted"].includes(job.status)) {
        analysis = {
          ...stored,
          status: job.status as ResearchAnalysis["status"],
          error: stored.error ?? job.error?.message ?? null,
        };
        this.ctx.db.research.updateAnalysis(stored.id, {
          status: analysis.status,
          error: analysis.error,
          finishedAt: stored.finishedAt ?? job.finishedAt,
        });
      }
    }
    const current = this.ctx.db.research.getVideo(stored.referenceVideoId)
      ? this.bundle(stored.referenceVideoId).fingerprint
      : null;
    return {
      ...analysis,
      stale: current !== null && current !== stored.inputFingerprint,
    };
  }

  async start({
    referenceVideoId,
    modelId,
  }: {
    referenceVideoId: string;
    modelId: string;
  }): Promise<ResearchAnalysis> {
    const video = this.ctx.db.research.getVideo(referenceVideoId);
    if (!video)
      throw new AppError("NOT_FOUND", "That reference video no longer exists.");
    // Refuse now, with the exact reason, rather than fail later in the queue.
    const prepared = await this.llm.prepare(modelId);
    const { fingerprint } = this.bundle(referenceVideoId);
    const now = this.ctx.now();
    const analysis: Omit<ResearchAnalysis, "stale"> = {
      id: this.ctx.newId(),
      projectId: video.projectId,
      referenceVideoId,
      jobId: null,
      status: "queued",
      modelId,
      modelName: prepared.ref.name,
      runtime: runtimeLabel(prepared.runtime),
      config: {
        tasks: [...ANALYSIS_TASKS],
        contextTokens: prepared.options.contextTokens,
        maxTokens: DEFAULT_ANALYZER_OPTIONS.maxTokens,
        temperature: DEFAULT_ANALYZER_OPTIONS.temperature,
      },
      inputFingerprint: fingerprint,
      sections: [],
      error: null,
      createdAt: now,
      startedAt: null,
      finishedAt: null,
    };
    this.ctx.db.research.insertAnalysis(analysis);
    const title =
      this.ctx.db.research.listSnapshots(referenceVideoId)[0]?.metadata.title;
    const job = this.jobs.submit({
      type: "research_analysis",
      label: `Video DNA analysis: ${title ?? `YouTube video ${video.videoId}`}`,
      adapterId: "llama.cpp",
      model: prepared.ref.name,
      projectId: null,
      episodeId: null,
      sceneId: null,
      slot: null,
      input: { analysisId: analysis.id },
    });
    this.ctx.db.research.updateAnalysis(analysis.id, { jobId: job.id });
    return this.get(analysis.id);
  }

  get(id: string): ResearchAnalysis {
    const stored = this.ctx.db.research.getAnalysis(id);
    if (!stored)
      throw new AppError("NOT_FOUND", "That analysis no longer exists.");
    return this.present(stored);
  }

  list(referenceVideoId: string): ResearchAnalysis[] {
    return this.ctx.db.research
      .listAnalyses(referenceVideoId)
      .map((item) => this.present(item));
  }

  cancel(id: string): ResearchAnalysis {
    const analysis = this.get(id);
    if (TERMINAL.has(analysis.status)) return analysis;
    if (analysis.jobId) this.jobs.cancel(analysis.jobId);
    return this.get(id);
  }

  delete(id: string): void {
    const analysis = this.get(id);
    if (!TERMINAL.has(analysis.status)) {
      throw new AppError("CONFLICT", "Cancel the analysis before deleting it.");
    }
    this.ctx.db.research.deleteAnalysis(id);
  }

  executor(): JobExecutor {
    return {
      canCancel: () => true,
      run: async (job, control) => {
        const analysisId = String(job.input.analysisId ?? "");
        const stored = this.ctx.db.research.getAnalysis(analysisId);
        if (!stored)
          throw new AppError(
            "NOT_FOUND",
            "The analysis this job belongs to was deleted.",
          );
        const update = (
          changes: Parameters<typeof this.ctx.db.research.updateAnalysis>[1],
        ) => this.ctx.db.research.updateAnalysis(analysisId, changes);
        const sections: AnalysisSection[] = [];
        update({
          status: "loading-model",
          startedAt: this.ctx.now(),
          sections: [],
          error: null,
          finishedAt: null,
        });
        control.reportProgress(null, "Loading the language model");
        try {
          const { bundle } = this.bundle(stored.referenceVideoId);
          await this.llm.withModel(
            stored.modelId,
            control.signal,
            async (provider, runtime) => {
              update({ status: "analyzing", runtime: runtimeLabel(runtime) });
              const tasks = stored.config.tasks as AnalysisTask[];
              for (const [index, task] of tasks.entries()) {
                if (control.signal.aborted)
                  throw new AppError(
                    "CANCELLED",
                    "The analysis was cancelled.",
                  );
                control.reportProgress(
                  index / tasks.length,
                  `${PLANNED_ANALYSES[task].label} (${index + 1} of ${tasks.length})`,
                );
                const section = await runAnalyzer(task, bundle, provider, {
                  ...DEFAULT_ANALYZER_OPTIONS,
                  signal: control.signal,
                });
                sections.push(section);
                update({ sections });
              }
              update({ status: "validating" });
              control.reportProgress(1, "Validating");
              this.validateStored(sections);
              this.llm.record(
                stored.modelId,
                runtimeLabel(runtime),
                true,
                "A Video DNA analysis completed with this model.",
              );
            },
          );
        } catch (error) {
          const shape = toErrorShape(error);
          const cancelled =
            control.signal.aborted || shape.code === "CANCELLED";
          update({
            status: cancelled ? "cancelled" : "failed",
            error: cancelled ? null : shape.message,
            sections,
            finishedAt: this.ctx.now(),
          });
          throw error;
        }
        update({ status: "completed", finishedAt: this.ctx.now() });
        const items = sections.reduce(
          (total, section) => total + section.items.length,
          0,
        );
        return {
          output: { analysisId, items },
          metadata: {
            sections: sections.map(
              (section) => `${section.task}: ${section.status}`,
            ),
          },
        };
      },
    };
  }

  /** Every cited item still exists in storage before the result is final. */
  private validateStored(sections: AnalysisSection[]): void {
    const db = this.ctx.db.research;
    for (const section of sections) {
      for (const item of section.items) {
        for (const evidence of item.evidence) {
          const exists =
            evidence.kind === "comment"
              ? db.getComment(evidence.targetId) !== null
              : evidence.kind === "transcript-segment"
                ? db.getSegment(evidence.targetId) !== null
                : evidence.kind === "transcript"
                  ? db.getTranscript(evidence.targetId) !== null
                  : evidence.kind === "metadata-snapshot"
                    ? db.getSnapshot(evidence.targetId) !== null
                    : db.getSampleById(evidence.targetId) !== null;
          if (!exists) {
            throw new AppError(
              "CONFLICT",
              "Research data the analysis cites was deleted while it ran. Run it again.",
            );
          }
        }
      }
    }
  }
}
