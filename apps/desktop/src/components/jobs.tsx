import {
  type Job,
  formatDuration,
  isActiveJob,
  isRetryableJob,
} from "@framebop/core";
import {
  CheckCircle2,
  CircleSlash,
  Clock,
  Loader2,
  PauseCircle,
  RotateCcw,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { openMediaPreview } from "../lib/dialogs";
import { useStudio } from "../store/studio";
import { AssetThumb } from "./media";
import { Badge, IconButton, ProgressBar, cx } from "./ui";
import { currentLanguage, t } from "../i18n";
import { jobLabel, progressText } from "../lib/jobLabels";

const SLOT_FIELD = {
  image: "imageAssetId",
  video: "videoAssetId",
  audio: "audioAssetId",
} as const;

/** The current time, refreshed every second while `active`. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/**
 * How long a job has been, or was, actually running. Null before it starts.
 * This is measured time, shown as time. It is never turned into a percentage.
 */
export function jobRunSeconds(job: Job, now: number): number | null {
  if (!job.startedAt) return null;
  // When a job was cut off by the application closing, nobody recorded the
  // moment it stopped, so how long it really ran is not known.
  if (job.status === "interrupted") return null;
  const end = job.finishedAt ? Date.parse(job.finishedAt) : now;
  return Math.max(0, (end - Date.parse(job.startedAt)) / 1000);
}

export function JobStatusIcon({ job }: { job: Job }) {
  switch (job.status) {
    case "pending":
      return (
        <Clock
          className="size-3.5 text-fg-dim"
          aria-label={t("jobs:waiting")}
        />
      );
    case "running":
      return (
        <Loader2
          className="size-3.5 animate-spin text-accent"
          aria-label={t("jobs:running")}
        />
      );
    case "completed":
      return (
        <CheckCircle2
          className="size-3.5 text-ok"
          aria-label={t("jobs:completed")}
        />
      );
    case "failed":
      return (
        <XCircle
          className="size-3.5 text-danger"
          aria-label={t("jobs:failed")}
        />
      );
    case "cancelled":
      return (
        <CircleSlash
          className="size-3.5 text-fg-dim"
          aria-label={t("jobs:cancelled")}
        />
      );
    case "interrupted":
      return (
        <PauseCircle
          className="size-3.5 text-warn"
          aria-label={t("jobs:interrupted")}
        />
      );
  }
}

/** A short description of where a job stands, using only reported facts. */
export function describeJobState(job: Job): string {
  switch (job.status) {
    case "pending":
      return t("jobs:waiting");
    case "running":
      if (job.cancelRequestedAt) return t("jobs:stopping");
      // A percentage only when the engine measured one.
      if (job.progress !== null) return `${Math.round(job.progress * 100)}%`;
      return job.progressMessage
        ? progressText(job.progressMessage)
        : t("jobs:working");
    case "completed":
      return t("jobs:done");
    case "failed":
      return t("jobs:failed");
    case "cancelled":
      return t("jobs:cancelled");
    case "interrupted":
      return t("jobs:interrupted");
  }
}

export function JobBadges({ job }: { job: Job }) {
  if (job.metadata.isTest === true)
    return <Badge tone="warn">{t("jobs:test")}</Badge>;
  if (job.metadata.maturity === "experimental") {
    return <Badge>{t("jobs:experimental")}</Badge>;
  }
  return null;
}

/** Whether the engine behind a running job is able to stop it. */
export function canStop(job: Job): boolean {
  return (
    job.status === "pending" || job.metadata.supportsCancellation !== false
  );
}

export function JobActions({ job }: { job: Job }) {
  const retryJob = useStudio((state) => state.retryJob);
  const cancelJob = useStudio((state) => state.cancelJob);

  if (isActiveJob(job)) {
    const stoppable = canStop(job);
    return (
      <IconButton
        label={
          stoppable
            ? job.status === "pending"
              ? t("jobs:removeFromTheQueue")
              : t("jobs:stopThisJob")
            : t("jobs:thisEngineCannotBeStoppedOnce")
        }
        icon={X}
        size="sm"
        disabled={!stoppable || job.cancelRequestedAt !== null}
        onClick={() => void cancelJob(job.id)}
      />
    );
  }
  if (isRetryableJob(job)) {
    return (
      <IconButton
        label={t("jobs:runAgainAsANewAttempt")}
        icon={RotateCcw}
        size="sm"
        onClick={() => void retryJob(job.id)}
      />
    );
  }
  return null;
}

/**
 * A completed job's result: a thumbnail that opens a larger preview, and the
 * means to put the result into the scene when it is not already there.
 */
export function JobOutput({ job }: { job: Job }) {
  const asset = useStudio((state) =>
    job.outputAssetId ? (state.assets[job.outputAssetId] ?? null) : null,
  );
  const inScene = useStudio((state) => {
    if (!job.slot || !job.outputAssetId) return false;
    const scene = state.scenes.find(
      (candidate) => candidate.id === job.sceneId,
    );
    return scene?.[SLOT_FIELD[job.slot]] === job.outputAssetId;
  });
  const sceneOpen = useStudio((state) =>
    state.scenes.some((candidate) => candidate.id === job.sceneId),
  );
  const applyJobOutput = useStudio((state) => state.applyJobOutput);

  if (job.status !== "completed" || !asset || job.type === "media_import") {
    return null;
  }
  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        title={t("jobs:previewTheResult")}
        onClick={() => openMediaPreview(asset)}
        className="overflow-hidden rounded border border-line-strong hover:border-accent/60"
      >
        <AssetThumb asset={asset} className="h-7 w-[50px]" />
      </button>
      {inScene ? (
        <span className="w-[86px] text-2xs text-fg-dim">
          {t("jobs:inTheScene")}
        </span>
      ) : (
        <button
          type="button"
          disabled={!sceneOpen}
          title={
            sceneOpen
              ? t("jobs:replaceTheSceneSCurrentMedia")
              : t("jobs:openThisJobSEpisodeTo")
          }
          onClick={() => void applyJobOutput(job.id)}
          className="h-6 w-[86px] rounded border border-accent/40 bg-accent/10 text-2xs font-medium text-accent hover:bg-accent/20 disabled:opacity-40"
        >
          {t("jobs:useInScene")}
        </button>
      )}
    </div>
  );
}

const clock = {
  format: (date: Date) =>
    new Intl.DateTimeFormat(currentLanguage(), {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).format(date),
};

export function JobRow({ job }: { job: Job }) {
  const selectScene = useStudio((state) => state.selectScene);
  const sceneIndex = useStudio((state) =>
    state.scenes.findIndex((scene) => scene.id === job.sceneId),
  );
  const now = useNow(job.status === "running");
  const runSeconds = jobRunSeconds(job, now);
  const engineName =
    typeof job.metadata.engineName === "string"
      ? job.metadata.engineName
      : null;

  return (
    <li className="flex items-center gap-3 px-3 py-1.5 hover:bg-raised/60">
      <JobStatusIcon job={job} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-xs text-fg">
            {jobLabel(job.label)}
          </span>
          <JobBadges job={job} />
          {job.attempt > 1 && (
            <span className="shrink-0 text-2xs text-fg-dim">
              {t("jobs:attempt", { attempt: job.attempt })}
            </span>
          )}
          {sceneIndex !== -1 && (
            <button
              type="button"
              onClick={() => selectScene(job.sceneId)}
              className="shrink-0 text-2xs text-fg-dim hover:text-accent"
            >
              {t("jobs:scene", { value: sceneIndex + 1 })}
            </button>
          )}
        </div>
        {job.error && job.status !== "cancelled" && (
          <p
            data-selectable
            className={cx(
              "truncate text-2xs",
              job.status === "interrupted" ? "text-warn" : "text-danger",
            )}
            title={job.error.message}
          >
            {job.error.message}
          </p>
        )}
        {job.status === "running" &&
          job.progressMessage &&
          job.progress !== null && (
            <p className="truncate text-2xs text-fg-dim">
              {progressText(job.progressMessage)}
            </p>
          )}
      </div>
      <JobOutput job={job} />
      {job.status === "running" && (
        <div className="w-24 shrink-0" title={engineName ?? undefined}>
          <ProgressBar value={job.progress} />
        </div>
      )}
      <span className="w-20 shrink-0 truncate text-right text-2xs text-fg-muted tabular-nums">
        {describeJobState(job)}
      </span>
      <span
        className="timecode w-14 shrink-0 text-right text-2xs text-fg-dim"
        title={
          job.status === "running"
            ? t("jobs:timeRunningSoFar")
            : t("jobs:timeItRan")
        }
      >
        {runSeconds === null ? "" : formatDuration(runSeconds)}
      </span>
      <span className="timecode w-16 shrink-0 text-right text-2xs text-fg-dim">
        {clock.format(
          new Date(job.finishedAt ?? job.startedAt ?? job.createdAt),
        )}
      </span>
      <div className="flex w-6 shrink-0 justify-end">
        <JobActions job={job} />
      </div>
    </li>
  );
}
