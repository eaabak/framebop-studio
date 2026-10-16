import { type LogEntry, isActiveJob } from "@framebop/core";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Inbox,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStudio } from "../store/studio";
import { JobRow } from "./jobs";
import { EmptyState, IconButton, ProgressBar, cx } from "./ui";
import { currentLanguage, t } from "../i18n";

type ActivityTab = "jobs" | "logs" | "errors";

// 24-hour form keeps the column narrow and unambiguous in a log.
const clock = {
  format: (date: Date) =>
    new Intl.DateTimeFormat(currentLanguage(), {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).format(date),
};

const LOG_TONES: Record<LogEntry["level"], string> = {
  debug: "text-fg-dim",
  info: "text-fg-muted",
  warn: "text-warn",
  error: "text-danger",
};

function LogList({ entries }: { entries: LogEntry[] }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [entries.length]);

  if (entries.length === 0) {
    return (
      <p className="px-3 py-3 text-xs text-fg-dim">
        {t("jobs:nothingLoggedYet")}
      </p>
    );
  }
  return (
    <div
      data-selectable
      className="px-3 py-1.5 font-mono text-2xs leading-[18px]"
    >
      {entries.map((entry) => (
        <div key={entry.seq} className="flex gap-3">
          <span className="shrink-0 text-fg-dim">
            {clock.format(new Date(entry.time))}
          </span>
          <span
            className={cx("w-9 shrink-0 uppercase", LOG_TONES[entry.level])}
          >
            {entry.level}
          </span>
          <span className="w-16 shrink-0 truncate text-fg-dim">
            {entry.scope}
          </span>
          <span className={cx("min-w-0 break-words", LOG_TONES[entry.level])}>
            {entry.message}
            {entry.data && (
              <span className="text-fg-dim"> {JSON.stringify(entry.data)}</span>
            )}
          </span>
        </div>
      ))}
      <div ref={end} />
    </div>
  );
}

/** Share of the open episode's scenes that have a picture, as real counts. */
function EpisodeCoverage() {
  const scenes = useStudio((state) => state.scenes);
  const episode = useStudio((state) => state.episode);
  if (!episode || scenes.length === 0) return null;
  const covered = scenes.filter(
    (scene) => scene.videoAssetId ?? scene.imageAssetId,
  ).length;

  return (
    <div
      className="flex items-center gap-2.5"
      title={t("jobs:scenesInThisEpisodeThatHave")}
    >
      <span className="text-2xs text-fg-dim">
        {t("jobs:scenesWithVisuals")}
      </span>
      <div className="w-24">
        <ProgressBar
          value={covered / scenes.length}
          tone={covered === scenes.length ? "ok" : "accent"}
        />
      </div>
      <span className="text-2xs text-fg-muted tabular-nums">
        {covered}/{scenes.length}
      </span>
    </div>
  );
}

export function ActivityPanel() {
  const jobs = useStudio((state) => state.jobs);
  const logs = useStudio((state) => state.logs);
  const queuePaused = useStudio((state) => state.queue.paused);
  const open = useStudio((state) => state.settings.activityPanelOpen);
  const updateSettings = useStudio((state) => state.updateSettings);
  const clearFinishedJobs = useStudio((state) => state.clearFinishedJobs);
  const [tab, setTab] = useState<ActivityTab>("jobs");

  const activeCount = jobs.filter(isActiveJob).length;
  // Interrupted jobs belong with the failures: they also need a decision.
  const troubledJobs = useMemo(
    () =>
      jobs.filter(
        (job) => job.status === "failed" || job.status === "interrupted",
      ),
    [jobs],
  );
  const errorLogs = useMemo(
    () => logs.filter((entry) => entry.level === "error"),
    [logs],
  );
  const hasFinished = jobs.some((job) => !isActiveJob(job));

  const tabs: {
    id: ActivityTab;
    label: string;
    count: number;
    tone?: string;
  }[] = [
    {
      id: "jobs",
      label: t("jobs:jobs"),
      count: activeCount,
      tone: "bg-accent/15 text-accent",
    },
    { id: "logs", label: t("jobs:log"), count: 0 },
    {
      id: "errors",
      label: t("jobs:errors"),
      count: troubledJobs.length,
      tone: "bg-danger/15 text-danger",
    },
  ];

  const toggle = () => void updateSettings({ activityPanelOpen: !open });

  return (
    <section
      aria-label={t("jobs:activity")}
      className={cx(
        "glass mx-2 mb-2 flex shrink-0 flex-col overflow-hidden rounded-2xl border",
        open ? "h-40" : "h-8",
      )}
    >
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-line pr-1.5 pl-2">
        <div role="tablist" className="flex items-center gap-0.5">
          {tabs.map(({ id, label, count, tone }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={open && tab === id}
              onClick={() => {
                setTab(id);
                if (!open) toggle();
              }}
              className={cx(
                "flex h-6 items-center gap-1.5 rounded px-2 text-xs transition-colors",
                open && tab === id
                  ? "bg-overlay text-fg"
                  : "text-fg-muted hover:text-fg",
              )}
            >
              {label}
              {count > 0 && (
                <span
                  className={cx(
                    "rounded px-1 text-2xs font-semibold tabular-nums",
                    tone,
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          ))}
          {queuePaused && (
            <span className="ml-2 rounded border border-warn/30 bg-warn/10 px-1.5 text-2xs text-warn">
              {t("jobs:productionQueueOnHold")}
            </span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <EpisodeCoverage />
          {open && tab === "jobs" && hasFinished && (
            <IconButton
              tone="danger"
              label={t("jobs:clearFinishedJobsAndResultsThat")}
              icon={Trash2}
              size="sm"
              onClick={() => void clearFinishedJobs()}
            />
          )}
          <IconButton
            label={open ? t("jobs:collapseActivity") : t("jobs:expandActivity")}
            icon={open ? ChevronDown : ChevronUp}
            size="sm"
            onClick={toggle}
          />
        </div>
      </div>

      {open && (
        <div className="min-h-0 flex-1 overflow-y-auto" role="tabpanel">
          {tab === "jobs" &&
            (jobs.length === 0 ? (
              <EmptyState
                compact
                icon={Inbox}
                title={t("jobs:noJobsYet")}
                description={t("jobs:importsAndProductionJobsAppearHere")}
              />
            ) : (
              <ul className="divide-y divide-line/60">
                {jobs.map((job) => (
                  <JobRow key={job.id} job={job} />
                ))}
              </ul>
            ))}
          {tab === "logs" && <LogList entries={logs} />}
          {tab === "errors" &&
            (troubledJobs.length === 0 && errorLogs.length === 0 ? (
              <EmptyState
                compact
                icon={CheckCircle2}
                title={t("jobs:noErrors")}
                description={t("jobs:failedAndInterruptedJobsAreListed")}
              />
            ) : (
              <>
                <ul className="divide-y divide-line/60">
                  {troubledJobs.map((job) => (
                    <JobRow key={job.id} job={job} />
                  ))}
                </ul>
                {errorLogs.length > 0 && <LogList entries={errorLogs} />}
              </>
            ))}
        </div>
      )}
    </section>
  );
}
