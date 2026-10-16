import {
  type EngineState,
  type EngineStatus,
  type Job,
  type ProductionTask,
  formatDuration,
  isActiveJob,
} from "@framebop/core";
import {
  ChevronRight,
  Cpu,
  Inbox,
  Pause,
  Play,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { CapabilitySummary, TASK_LABELS } from "../components/engines";
import {
  JobBadges,
  JobRow,
  canStop,
  jobRunSeconds,
  useNow,
} from "../components/jobs";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  ProgressBar,
  Spinner,
} from "../components/ui";
import { useStudio } from "../store/studio";
import {
  NATIVE_IMAGE_ENGINE,
  RuntimeInstall,
} from "./blueprint/MediaProduction";
import { formatBytes, t } from "../i18n";
import { jobLabel, parameterText, progressText } from "../lib/jobLabels";

const isProduction = (job: Job) => job.type !== "media_import";

/** The production job that is running right now, shown large. */
function RunningJob({ job }: { job: Job }) {
  const cancelJob = useStudio((state) => state.cancelJob);
  const selectScene = useStudio((state) => state.selectScene);
  const setTab = useStudio((state) => state.setTab);
  const sceneIndex = useStudio((state) =>
    state.scenes.findIndex((scene) => scene.id === job.sceneId),
  );
  const now = useNow(true);
  const runSeconds = jobRunSeconds(job, now) ?? 0;
  const stoppable = canStop(job);
  const engineName =
    typeof job.metadata.engineName === "string"
      ? job.metadata.engineName
      : null;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-accent/40 bg-accent/5 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-fg">
              {jobLabel(job.label)}
            </h3>
            <JobBadges job={job} />
          </div>
          <p className="mt-0.5 text-xs text-fg-muted">
            {engineName ?? t("production:engine")}
            {job.model && ` · ${job.model}`}
            {job.attempt > 1 &&
              t("production:attempt", { attempt: job.attempt })}
            {sceneIndex !== -1 && (
              <>
                {" · "}
                <button
                  type="button"
                  className="text-accent hover:underline"
                  onClick={() => {
                    selectScene(job.sceneId);
                    setTab("scenes");
                  }}
                >
                  {t("production:scene", { value: sceneIndex + 1 })}
                </button>
              </>
            )}
          </p>
        </div>
        <Button
          icon={X}
          disabled={!stoppable || job.cancelRequestedAt !== null}
          title={
            stoppable
              ? undefined
              : t("production:thisEngineCannotBeStoppedOnce")
          }
          onClick={() => void cancelJob(job.id)}
        >
          {job.cancelRequestedAt
            ? t("production:stopping")
            : t("production:stop")}
        </Button>
      </div>

      <ProgressBar value={job.progress} />
      <div className="flex items-baseline justify-between gap-4 text-xs">
        <span className="text-fg-muted">
          {job.progress !== null
            ? `${Math.round(job.progress * 100)}%${job.progressMessage ? ` · ${progressText(job.progressMessage)}` : ""}`
            : job.progressMessage
              ? progressText(job.progressMessage)
              : t("production:working")}
        </span>
        <span className="timecode text-fg-muted">
          {t("production:runningFor", {
            runSeconds: formatDuration(runSeconds),
          })}
        </span>
      </div>
      {job.metadata.reportsProgress === false && (
        <p className="text-2xs leading-4 text-fg-dim">
          {t("production:thisEngineDoesNotReportProgress")}
        </p>
      )}
      {!stoppable && (
        <p className="text-2xs leading-4 text-fg-dim">
          {t("production:thisEngineCannotBeStoppedFrom")}
        </p>
      )}
    </div>
  );
}

function QueueSection() {
  const jobs = useStudio((state) => state.jobs);
  const queue = useStudio((state) => state.queue);
  const setQueuePaused = useStudio((state) => state.setQueuePaused);

  const production = jobs.filter(isProduction);
  const running = production.filter((job) => job.status === "running");
  // The list arrives newest first; the queue runs oldest first.
  const waiting = production
    .filter((job) => job.status === "pending")
    .reverse();

  return (
    <section aria-labelledby="queue-heading">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <h2 id="queue-heading" className="eyebrow">
            {t("production:productionQueue")}
          </h2>
          <span className="text-2xs text-fg-dim">
            {t("production:oneProductionJobRunsAtA")}
          </span>
        </div>
        <Button
          size="sm"
          icon={queue.paused ? Play : Pause}
          variant={queue.paused ? "primary" : "secondary"}
          onClick={() => void setQueuePaused(!queue.paused)}
        >
          {queue.paused
            ? t("production:resumeQueue")
            : t("production:holdQueue")}
        </Button>
      </div>

      {queue.paused && (
        <div
          role="status"
          className="mb-3 rounded-lg border border-warn/30 bg-warn/10 p-3 text-xs leading-5 text-fg"
        >
          {queue.pausedReason === "restart" ? (
            <>
              <strong className="font-semibold">
                {t("production:jobsWaitingAfterRestart", {
                  count: waiting.length,
                })}
              </strong>{" "}
              {t("production:resumeOrRemoveWaiting", { count: waiting.length })}
            </>
          ) : (
            <>
              <strong className="font-semibold">
                {t("production:theQueueIsOnHold")}
              </strong>{" "}
              {t("production:newProductionJobsWaitUntilYou")}
            </>
          )}
        </div>
      )}

      {running.length === 0 && waiting.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line-strong py-5">
          <EmptyState
            compact
            icon={Inbox}
            title={t("production:nothingIsQueued")}
            description={t("production:selectASceneOpenItsGenerate")}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {running.map((job) => (
            <RunningJob key={job.id} job={job} />
          ))}
          {waiting.length > 0 && (
            <div className="overflow-hidden card-surface rounded-xl border">
              <h3 className="border-b border-line px-3 py-2 text-xs font-medium text-fg-muted">
                {t("production:waiting", { waiting: waiting.length })}
              </h3>
              <ul className="divide-y divide-line/60">
                {waiting.map((job) => (
                  <JobRow key={job.id} job={job} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function HistorySection() {
  const jobs = useStudio((state) => state.jobs);
  const clearFinishedJobs = useStudio((state) => state.clearFinishedJobs);
  const finished = jobs.filter((job) => !isActiveJob(job));
  const interrupted = finished.filter((job) => job.status === "interrupted");

  return (
    <section aria-labelledby="history-heading">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="history-heading" className="eyebrow">
          {t("production:history")}
        </h2>
        {finished.length > 0 && (
          <Button
            size="sm"
            variant="danger"
            icon={Trash2}
            title={t("production:alsoDeletesResultsThatNoScene")}
            onClick={() => void clearFinishedJobs()}
          >
            {t("production:clearHistory")}
          </Button>
        )}
      </div>
      {interrupted.length > 0 && (
        <p className="mb-3 card-surface rounded-xl border p-3 text-xs leading-5 text-fg-muted">
          {interrupted.length === 1
            ? t("production:n1JobWasRunningWhenThe")
            : t("production:jobsWereRunningWhenTheApplication", {
                interrupted: interrupted.length,
              })}
        </p>
      )}
      <div className="overflow-hidden card-surface rounded-xl border">
        {finished.length === 0 ? (
          <div className="py-4">
            <EmptyState
              compact
              icon={Inbox}
              title={t("production:noFinishedJobs")}
              description={t(
                "production:completedFailedCancelledAndInterruptedJobs",
              )}
            />
          </div>
        ) : (
          <ul className="divide-y divide-line/60">
            {finished.map((job) => (
              <JobRow key={job.id} job={job} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

const STATE_BADGES: Record<
  EngineState,
  { tone: "ok" | "accent" | "neutral" | "warn"; label: string }
> = {
  available: {
    tone: "ok",
    get label() {
      return t("production:available");
    },
  },
  detected: {
    tone: "accent",
    get label() {
      return t("production:installedNotReady");
    },
  },
  not_found: {
    tone: "warn",
    get label() {
      return t("production:notFound");
    },
  },
  planned: {
    tone: "neutral",
    get label() {
      return t("production:planned");
    },
  },
};

const KIND_LABELS: Record<EngineStatus["kind"], string> = {
  get import() {
    return t("production:import");
  },
  get tool() {
    return t("production:tool");
  },
  get image() {
    return t("production:images");
  },
  get video() {
    return t("production:imagesAndVideo");
  },
  get speech() {
    return t("production:speech");
  },
  get render() {
    return t("production:rendering");
  },
};

function EngineCard({ engine }: { engine: EngineStatus }) {
  const badge = STATE_BADGES[engine.state];
  return (
    <li className="flex flex-col gap-2 card-surface rounded-xl border p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-ui font-semibold text-fg">
              {engine.name}
            </h3>
            {engine.isTest && <Badge tone="warn">{t("production:test")}</Badge>}
          </div>
          <p className="text-2xs text-fg-dim">
            {KIND_LABELS[engine.kind]}
            {engine.version &&
              t("production:version", { version: engine.version })}
          </p>
        </div>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </div>
      <p className="text-xs font-medium text-fg-muted">{engine.summary}</p>
      <p className="text-xs leading-5 text-fg-dim">{engine.detail}</p>
      {engine.location && (
        <code
          data-selectable
          className="truncate font-mono text-2xs text-fg-dim"
          title={engine.location}
        >
          {engine.location}
        </code>
      )}
      {engine.id === NATIVE_IMAGE_ENGINE && <RuntimeInstall />}
      {engine.capabilities.map((capability) => (
        <details
          key={capability.task}
          className="rounded-md border border-line bg-canvas"
        >
          <summary className="flex cursor-default items-center justify-between gap-2 px-2.5 py-1.5 text-xs text-fg-muted marker:text-fg-dim">
            <span className="flex-1 pl-1">{TASK_LABELS[capability.task]}</span>
            <span
              className={
                capability.available
                  ? "text-2xs text-ok"
                  : "text-2xs text-fg-dim"
              }
            >
              {capability.available
                ? t("production:ready")
                : t("production:notReady")}
            </span>
          </summary>
          <div className="flex flex-col gap-2 border-t border-line p-2.5">
            {!capability.available && capability.reason && (
              <p className="text-2xs leading-4 text-warn">
                {capability.reason}
              </p>
            )}
            <CapabilitySummary capability={capability} />
            {capability.resolutions.length > 0 && (
              <p className="timecode text-2xs text-fg-dim">
                {t("production:sizes", {
                  capability: capability.resolutions
                    .map((size) => `${size.width}×${size.height}`)
                    .join(", "),
                })}
              </p>
            )}
            {capability.parameters.length > 0 && (
              <p className="text-2xs text-fg-dim">
                {t("production:settings", {
                  capability: capability.parameters
                    .map((spec) => parameterText(spec).label)
                    .join(", "),
                })}
              </p>
            )}
          </div>
        </details>
      ))}
    </li>
  );
}

/** Whether a real engine (not the test adapter) can do a task right now. */
function hasRealEngine(engines: EngineStatus[], task: ProductionTask): boolean {
  return engines.some(
    (engine) =>
      !engine.isTest &&
      engine.capabilities.some(
        (capability) => capability.task === task && capability.available,
      ),
  );
}

const BADGE_LABELS = {
  Manual: "production:manual",
  Engine: "production:engine",
  Planned: "production:planned",
} as const;

interface Stage {
  name: string;
  badge: "Manual" | "Engine" | "Planned";
  today: string;
}

function PipelineSection() {
  const engines = useStudio((state) => state.engines);
  const stage = (name: string, manual: string, task?: ProductionTask): Stage =>
    task && hasRealEngine(engines, task)
      ? {
          name,
          badge: "Engine",
          today: t("production:manualOrGenerateWithAnEngine", { manual }),
        }
      : { name, badge: "Manual", today: manual };

  // What each step can be done with today. It reflects this installation, so
  // a step only says "Engine" while a real one is actually usable.
  const stages: Stage[] = [
    stage(t("production:script"), t("production:writeOrPasteText")),
    stage(t("production:scenes"), t("production:splitTheScriptOrAddBy")),
    stage(
      t("production:images"),
      t("production:importFinishedStills"),
      "image_generation",
    ),
    stage(
      t("production:animation"),
      t("production:importFinishedClips"),
      "video_generation",
    ),
    stage(
      t("production:narration"),
      t("production:importRecordedAudio"),
      "audio_generation",
    ),
    hasRealEngine(engines, "video_render")
      ? {
          name: t("production:finalVideo"),
          badge: "Engine",
          today: t("production:renderAnMp4InExport"),
        }
      : {
          name: t("production:finalVideo"),
          badge: "Manual",
          today: t("production:setUpTheRendererToExport"),
        },
  ];

  return (
    <section aria-labelledby="pipeline-heading">
      <h2 id="pipeline-heading" className="eyebrow mb-3">
        {t("production:pipeline")}
      </h2>
      <ol className="flex items-stretch gap-1">
        {stages.map((entry, index) => (
          <li
            key={entry.name}
            className="flex min-w-0 flex-1 items-stretch gap-1"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 card-surface rounded-xl border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-ui font-semibold text-fg">
                  {entry.name}
                </span>
                <Badge
                  tone={
                    entry.badge === "Engine"
                      ? "ok"
                      : entry.badge === "Manual"
                        ? "accent"
                        : "neutral"
                  }
                >
                  {t(BADGE_LABELS[entry.badge])}
                </Badge>
              </div>
              <span className="text-2xs leading-4 text-fg-muted">
                {entry.today}
              </span>
            </div>
            {index < stages.length - 1 && (
              <ChevronRight
                className="size-3.5 shrink-0 self-center text-fg-dim"
                aria-hidden
              />
            )}
          </li>
        ))}
      </ol>
      <p className="mt-2.5 text-2xs leading-4 text-fg-dim">
        {t("production:manualStepsWorkWithMediaYou")}
      </p>
    </section>
  );
}

export function ProductionView() {
  const engines = useStudio((state) => state.engines);
  const enginesState = useStudio((state) => state.enginesState);
  const system = useStudio((state) => state.system);
  const refreshEngines = useStudio((state) => state.refreshEngines);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 p-6">
        <header>
          <h1 className="text-lg font-semibold tracking-tight text-fg">
            {t("production:production")}
          </h1>
          <p className="text-xs text-fg-muted">
            {t("production:theJobsThisInstallationIsRunning")}
          </p>
        </header>

        <QueueSection />
        <HistorySection />

        <section aria-labelledby="engines-heading">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="engines-heading" className="eyebrow">
              {t("production:engines")}
            </h2>
            <Button
              size="sm"
              variant="ghost"
              icon={RefreshCw}
              busy={enginesState === "loading"}
              onClick={() => void refreshEngines()}
            >
              {t("production:scanAgain")}
            </Button>
          </div>
          {enginesState === "error" ? (
            <ErrorState
              message={t("production:theEnginesCouldNotBeScanned")}
              onRetry={() => void refreshEngines()}
            />
          ) : engines.length === 0 ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] items-start gap-3">
              {engines.map((engine) => (
                <EngineCard key={engine.id} engine={engine} />
              ))}
            </ul>
          )}
        </section>

        <PipelineSection />

        {system && (
          <section aria-labelledby="hardware-heading">
            <h2 id="hardware-heading" className="eyebrow mb-3">
              {t("production:thisComputer")}
            </h2>
            <div className="flex items-center gap-4 card-surface rounded-xl border p-3.5">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-raised text-fg-dim">
                <Cpu className="size-4" aria-hidden />
              </div>
              <dl className="grid flex-1 grid-cols-4 gap-4 text-xs">
                {[
                  [t("production:processor"), system.hardware.cpuModel],
                  [t("production:cores"), String(system.hardware.cpuCores)],
                  [
                    t("production:memory"),
                    formatBytes(system.hardware.totalMemoryBytes),
                  ],
                  [
                    t("production:gpuAcceleration"),
                    system.hardware.accelerator === "apple-metal"
                      ? t("production:appleMetalMemorySharedWithThe")
                      : t("production:notDetectedOnThisPlatformYet"),
                  ],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <dt className="text-2xs text-fg-dim">{label}</dt>
                    <dd
                      data-selectable
                      className="truncate text-fg"
                      title={value}
                    >
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
            <p className="mt-2.5 text-2xs leading-4 text-fg-dim">
              {t("production:aSummaryTheHardwareSectionOf")}
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
