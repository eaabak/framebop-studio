import {
  AppError,
  type Job,
  type JobType,
  PRODUCTION_TASKS,
  type QueueStatus,
  type SceneSlot,
  isRetryableJob,
  toErrorShape,
  type JobStage,
} from "@framebop/core";
import type { EngineContext } from "../context";

export interface JobControl {
  /** Aborted when the job is cancelled or the engine shuts down. */
  signal: AbortSignal;
  /**
   * Publishes progress measured by whoever does the work: a fraction in 0..1,
   * or null while the amount of work cannot be measured. Never an estimate.
   */
  reportProgress(fraction: number | null, message?: string | null): void;
  /** Records the phase a generation has reached; clears its progress. */
  setStage(stage: JobStage): void;
}

export interface JobResult {
  output: Record<string, unknown>;
  /** Facts about the run to keep with the job. Merged into its metadata. */
  metadata?: Record<string, unknown>;
}

export interface JobExecutor {
  /** Whether this job can be stopped once it is running. */
  canCancel(job: Job): boolean;
  run(job: Job, control: JobControl): Promise<JobResult>;
}

export interface JobSpec {
  type: JobType;
  label: string;
  adapterId: string | null;
  model: string | null;
  projectId: string | null;
  episodeId: string | null;
  sceneId: string | null;
  slot: SceneSlot | null;
  input: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  attempt?: number;
  retryOfJobId?: string | null;
}

/**
 * Jobs are sorted into lanes that advance independently.
 *
 * Production work loads models and can occupy most of the machine's memory
 * for minutes, so it runs strictly one job at a time. Importing a file is
 * cheap disk work; it gets its own lane so that bringing in finished media
 * never has to wait behind a long generation.
 */
type Lane = "import" | "production" | "inspection";

const LANES: Readonly<
  Record<Lane, { types: readonly JobType[]; concurrency: number }>
> = {
  import: { types: ["media_import"], concurrency: 2 },
  // Inspecting a finished video is decoding, not generation: it never waits
  // behind a render, and one runs at a time.
  inspection: { types: ["video_inspection"], concurrency: 1 },
  // Language model analyses share the production lane: a loaded language
  // model and a generation model never compete for memory.
  production: {
    types: [...PRODUCTION_TASKS, "research_analysis", "story_generation"],
    concurrency: 1,
  },
};

const laneOf = (type: JobType): Lane =>
  type === "media_import"
    ? "import"
    : type === "video_inspection"
      ? "inspection"
      : "production";

/** Settings row that remembers whether the production lane is on hold. */
const QUEUE_STATE_KEY = "productionQueue";
const PROGRESS_INTERVAL_MS = 100;

interface RunningJob {
  job: Job;
  lane: Lane;
  abort: AbortController;
  settled: Promise<void>;
}

export interface RecoveryReport {
  /** Jobs found running from a previous process, now marked interrupted. */
  interrupted: number;
  /** Production jobs still waiting, which are being held for the user. */
  heldPending: number;
}

/**
 * The production job queue.
 *
 * SQLite is the queue: a job is a row, waiting jobs are the rows with status
 * "pending", and starting one is a single transaction that flips it to
 * "running". Nothing about a job lives only in memory, so the history and
 * everything still waiting survive a restart or a crash.
 *
 * What does not survive is work in progress. A job that was running when the
 * process stopped is marked "interrupted" on the next start and is never
 * restarted on its own: its engine may have been minutes into an expensive
 * run, and running it again is a decision for the user. For the same reason,
 * if production jobs were still waiting, the production lane starts on hold
 * until the user resumes it.
 */
export class JobQueue {
  private readonly executors = new Map<JobType, JobExecutor>();
  private readonly running = new Map<string, RunningJob>();
  private idleWaiters: (() => void)[] = [];
  private stopping = false;
  private paused = false;
  private pausedReason: QueueStatus["pausedReason"] = null;

  constructor(private readonly ctx: EngineContext) {}

  register(type: JobType, executor: JobExecutor): void {
    this.executors.set(type, executor);
  }

  /** Reconciles the stored queue with reality. Call once, before `start`. */
  recover(): RecoveryReport {
    const interrupted = this.ctx.db.jobs.markRunningAsInterrupted(
      this.ctx.now(),
    );
    const heldPending = this.ctx.db.jobs.countByStatus(
      LANES.production.types,
      "pending",
    );

    const stored = this.ctx.db.settings.getAll()[QUEUE_STATE_KEY] as
      { paused?: unknown; reason?: unknown } | undefined;
    if (stored?.paused === true) {
      this.paused = true;
      this.pausedReason = stored.reason === "restart" ? "restart" : "user";
    } else if (heldPending > 0) {
      this.setPausedState(true, "restart");
    }
    return { interrupted, heldPending };
  }

  /** Begins running whatever is allowed to run. */
  start(): void {
    this.pump();
  }

  submit(spec: JobSpec): Job {
    if (!this.executors.has(spec.type)) {
      throw new AppError(
        "UNSUPPORTED",
        `Nothing can run “${spec.type}” jobs yet.`,
      );
    }
    const now = this.ctx.now();
    const job: Job = {
      id: this.ctx.newId(),
      type: spec.type,
      status: "pending",
      label: spec.label,
      progress: null,
      progressMessage: null,
      stage: null,
      adapterId: spec.adapterId,
      model: spec.model,
      projectId: spec.projectId,
      episodeId: spec.episodeId,
      sceneId: spec.sceneId,
      slot: spec.slot,
      input: spec.input,
      output: null,
      outputAssetId: null,
      metadata: spec.metadata ?? {},
      error: null,
      attempt: spec.attempt ?? 1,
      retryOfJobId: spec.retryOfJobId ?? null,
      cancelRequestedAt: null,
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      updatedAt: now,
    };

    this.ctx.db.transaction(() => {
      // One waiting or running job per scene slot and kind of work. Two would
      // race to fill the same slot, and for generation would cost twice.
      if (job.sceneId && job.slot) {
        const existing = this.ctx.db.jobs.findActiveForTarget(
          job.type,
          job.sceneId,
          job.slot,
        );
        if (existing) {
          throw new AppError(
            "CONFLICT",
            `“${existing.label}” is already ${existing.status === "running" ? "running" : "waiting"} for this scene. Wait for it to finish or cancel it first.`,
          );
        }
      }
      this.ctx.db.jobs.insert(job);
    });
    this.ctx.emit({ type: "job.updated", job });
    this.pump();
    return this.ctx.db.jobs.get(job.id) ?? job;
  }

  cancel(id: string): Job {
    const active = this.running.get(id);
    if (active) {
      const executor = this.executors.get(active.job.type);
      if (!executor?.canCancel(active.job)) {
        throw new AppError(
          "UNSUPPORTED",
          "This engine cannot stop a job once it has started. It will run to the end.",
        );
      }
      const requestedAt = this.ctx.now();
      active.job = { ...active.job, cancelRequestedAt: requestedAt };
      this.ctx.db.jobs.update(
        id,
        { cancelRequestedAt: requestedAt },
        requestedAt,
      );
      this.ctx.emit({ type: "job.updated", job: active.job });
      // The status changes once the executor has actually stopped.
      active.abort.abort();
      return active.job;
    }

    const job = this.ctx.db.jobs.get(id);
    if (!job) throw new AppError("NOT_FOUND", "That job no longer exists.");
    if (job.status !== "pending") {
      throw new AppError("CONFLICT", "That job has already finished.");
    }
    return this.finish(job, { status: "cancelled" }) ?? job;
  }

  /**
   * Queues a new attempt with the same input. The earlier job stays in the
   * history, and the new one records which job it retries.
   */
  retry(id: string): Job {
    const job = this.ctx.db.jobs.get(id);
    if (!job) throw new AppError("NOT_FOUND", "That job no longer exists.");
    if (!isRetryableJob(job)) {
      throw new AppError(
        "CONFLICT",
        "Only failed, cancelled or interrupted jobs can be retried.",
      );
    }
    return this.submit({
      type: job.type,
      label: job.label,
      adapterId: job.adapterId,
      model: job.model,
      projectId: job.projectId,
      episodeId: job.episodeId,
      sceneId: job.sceneId,
      slot: job.slot,
      input: job.input,
      metadata: job.metadata,
      attempt: job.attempt + 1,
      retryOfJobId: job.id,
    });
  }

  /**
   * Stops every matching job and waits until none of them is still working.
   * Used before deleting what a job belongs to, so it applies even to jobs
   * the user could not cancel: the engine stops waiting for them.
   */
  async cancelMatching(predicate: (job: Job) => boolean): Promise<void> {
    for (const job of this.ctx.db.jobs.listByStatus("pending")) {
      if (predicate(job)) this.finish(job, { status: "cancelled" });
    }
    const active = [...this.running.values()].filter((entry) =>
      predicate(entry.job),
    );
    for (const entry of active) entry.abort.abort();
    await Promise.all(active.map((entry) => entry.settled));
  }

  status(): QueueStatus {
    return {
      paused: this.paused,
      pausedReason: this.pausedReason,
      pendingCount: this.ctx.db.jobs.countByStatus(
        LANES.production.types,
        "pending",
      ),
      runningCount: [...this.running.values()].filter(
        (entry) => entry.lane === "production",
      ).length,
    };
  }

  /** Holds or releases the production lane. A running job is not affected. */
  setPaused(paused: boolean): QueueStatus {
    this.setPausedState(paused, paused ? "user" : null);
    this.pump();
    return this.status();
  }

  /** Resolves once nothing is running and nothing is allowed to start. */
  idle(): Promise<void> {
    if (this.running.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  /**
   * Stops work for shutdown. Running jobs become "interrupted"; waiting jobs
   * are left as they are, to be offered again on the next start.
   */
  async shutdown(): Promise<void> {
    this.stopping = true;
    const active = [...this.running.values()];
    for (const entry of active) entry.abort.abort();
    await Promise.all(active.map((entry) => entry.settled));
  }

  private setPausedState(
    paused: boolean,
    reason: QueueStatus["pausedReason"],
  ): void {
    this.paused = paused;
    this.pausedReason = reason;
    this.ctx.db.settings.set(
      QUEUE_STATE_KEY,
      { paused, reason },
      this.ctx.now(),
    );
    this.ctx.emit({ type: "queue.updated", queue: this.status() });
  }

  private pump(): void {
    for (const lane of Object.keys(LANES) as Lane[]) {
      const { types, concurrency } = LANES[lane];
      const held = lane === "production" && this.paused;
      while (!this.stopping && !held && this.countRunning(lane) < concurrency) {
        const next = this.ctx.db.jobs.claimNextPending(types, this.ctx.now());
        if (!next) break;
        this.run(next, lane);
      }
    }
    if (this.running.size === 0) {
      for (const resolve of this.idleWaiters.splice(0)) resolve();
    }
  }

  private countRunning(lane: Lane): number {
    let count = 0;
    for (const entry of this.running.values()) {
      if (entry.lane === lane) count += 1;
    }
    return count;
  }

  /** Runs a job that has just been claimed (and is already marked running). */
  private run(claimed: Job, lane: Lane): void {
    const executor = this.executors.get(claimed.type);
    const abort = new AbortController();
    const entry: RunningJob = {
      job: claimed,
      lane,
      abort,
      settled: Promise.resolve(),
    };
    this.running.set(claimed.id, entry);
    this.ctx.emit({ type: "job.updated", job: claimed });
    if (lane === "production") {
      this.ctx.emit({ type: "queue.updated", queue: this.status() });
    }

    let lastPublished = 0;
    const control: JobControl = {
      signal: abort.signal,
      reportProgress: (fraction, message = null) => {
        const progress =
          fraction === null ? null : Math.min(1, Math.max(0, fraction));
        const changedKind =
          (progress === null) !== (entry.job.progress === null) ||
          message !== entry.job.progressMessage;
        entry.job = { ...entry.job, progress, progressMessage: message };
        // A copy reports thousands of times a second; publish at a calm rate,
        // but never hold back a change of phase or the final value.
        const now = Date.now();
        if (
          !changedKind &&
          progress !== 1 &&
          now - lastPublished < PROGRESS_INTERVAL_MS
        ) {
          return;
        }
        lastPublished = now;
        this.ctx.db.jobs.update(
          entry.job.id,
          { progress, progressMessage: message },
          this.ctx.now(),
        );
        this.ctx.emit({ type: "job.updated", job: entry.job });
      },
      setStage: (stage) => {
        if (entry.job.stage === stage) return;
        entry.job = {
          ...entry.job,
          stage,
          progress: null,
          progressMessage: null,
        };
        this.ctx.db.jobs.update(
          entry.job.id,
          { stage, progress: null, progressMessage: null },
          this.ctx.now(),
        );
        this.ctx.emit({ type: "job.updated", job: entry.job });
      },
    };

    entry.settled = (async () => {
      try {
        if (!executor) {
          throw new AppError(
            "UNSUPPORTED",
            "Nothing in this build can run this job.",
          );
        }
        const result = await executor.run(entry.job, control);
        this.finish(entry.job, {
          status: "completed",
          progress: 1,
          output: result.output,
          metadata: { ...entry.job.metadata, ...result.metadata },
        });
      } catch (error) {
        if (abort.signal.aborted) {
          // Stopped on request: by the user, or because the engine is closing.
          this.finish(
            entry.job,
            this.stopping
              ? {
                  status: "interrupted",
                  error: {
                    code: "INTERRUPTED",
                    message:
                      "The application closed while this job was running.",
                  },
                }
              : { status: "cancelled" },
          );
        } else {
          const shape = toErrorShape(error);
          this.finish(entry.job, {
            status: "failed",
            error: { code: shape.code, message: shape.message },
          });
          this.ctx.log.scope("jobs").error(`${entry.job.label} failed`, {
            jobId: entry.job.id,
            code: shape.code,
            reason: shape.message,
            // Stack traces only help for defects, not for expected failures.
            ...(shape.code === "INTERNAL" && error instanceof Error
              ? { stack: error.stack }
              : {}),
          });
        }
      } finally {
        this.running.delete(entry.job.id);
        if (lane === "production") {
          this.ctx.emit({ type: "queue.updated", queue: this.status() });
        }
        this.pump();
      }
    })();
  }

  /** Writes a final state. Returns null if the job's row is already gone. */
  private finish(
    job: Job,
    changes: Pick<Job, "status"> &
      Partial<Pick<Job, "progress" | "output" | "metadata" | "error">>,
  ): Job | null {
    const finishedAt = this.ctx.now();
    this.ctx.db.jobs.update(
      job.id,
      {
        progress: null,
        progressMessage: null,
        ...changes,
        finishedAt,
      },
      finishedAt,
    );
    // Deleting a project removes its job rows; do not bring them back.
    const stored = this.ctx.db.jobs.get(job.id);
    if (stored === null) return null;
    this.ctx.emit({ type: "job.updated", job: stored });
    if (stored.status === "completed") {
      this.ctx.log.scope("jobs").info(`${stored.label} finished`, {
        jobId: stored.id,
      });
    }
    return stored;
  }
}
