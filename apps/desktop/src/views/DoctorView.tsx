/**
 * Scene Doctor: technical inspection of a finished video, a Framebop export
 * or any MP4. It reports measurements with their times and pictures taken
 * from the video; it does not judge artistic quality and never changes the
 * video. Works without any AI model.
 */
import {
  type DoctorExport,
  ISSUE_SEVERITIES,
  ISSUE_TYPES,
  type Inspection,
  type InspectionIssue,
  type IssueSeverity,
  type IssueType,
  type RenderRecord,
  formatClock,
  isActiveJob,
} from "@framebop/core";
import {
  Clapperboard,
  FileVideo,
  Play,
  Stethoscope,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, EmptyState, ProgressBar, cx } from "../components/ui";
import { formatDateTime, t } from "../i18n";
import { bridge } from "../lib/bridge";
import { errorMessage } from "../lib/errors";
import { useStudio } from "../store/studio";

const TONE: Record<IssueSeverity, "danger" | "warn" | "accent" | "neutral"> = {
  critical: "danger",
  warning: "warn",
  review: "accent",
  info: "neutral",
};
const MARKER: Record<IssueSeverity, string> = {
  critical: "bg-danger",
  warning: "bg-warn",
  review: "bg-accent",
  info: "bg-fg-dim",
};

const severityLabel = (severity: IssueSeverity) =>
  ({
    critical: t("doctor:severityCritical"),
    warning: t("doctor:severityWarning"),
    review: t("doctor:severityReview"),
    info: t("doctor:severityInfo"),
  })[severity];

const typeLabel = (type: IssueType) =>
  ({
    unreadable: t("doctor:typeUnreadable"),
    decode_error: t("doctor:typeDecodeError"),
    missing_frames: t("doctor:typeMissingFrames"),
    black: t("doctor:typeBlack"),
    frozen: t("doctor:typeFrozen"),
    missing_audio: t("doctor:typeMissingAudio"),
    silence: t("doctor:typeSilence"),
    clipping: t("doctor:typeClipping"),
    duration_mismatch: t("doctor:typeDurationMismatch"),
    stream_mismatch: t("doctor:typeStreamMismatch"),
    timeline_gap: t("doctor:typeTimelineGap"),
  })[type];

const num = (value: unknown) => String(value ?? "–");

const statusLabel = (status: Inspection["status"]) =>
  ({
    pending: t("doctor:waiting"),
    running: t("doctor:stageAnalyzing"),
    completed: "",
    failed: t("doctor:statusFailed"),
    cancelled: t("doctor:statusCancelled"),
    interrupted: t("doctor:statusInterrupted"),
  })[status];

/** What the finding is, how it was found, and what to do: by type. */
function explain(issue: InspectionIssue): { what: string; check: string } {
  const m = issue.measured;
  switch (issue.type) {
    case "unreadable":
      return {
        what: t("doctor:explainUnreadable"),
        check: t("doctor:checkUnreadable"),
      };
    case "decode_error":
      return {
        what: t("doctor:explainDecodeError", { count: Number(m.errors ?? 0) }),
        check: t("doctor:checkDecodeError"),
      };
    case "missing_frames":
      return {
        what: t("doctor:explainMissingFrames", {
          decoded: num(m.decodedFrames),
          expected: num(m.expectedFrames),
        }),
        check: t("doctor:checkMissingFrames"),
      };
    case "black":
      return {
        what: t("doctor:explainBlack", { seconds: num(m.seconds) }),
        check: t("doctor:checkBlack"),
      };
    case "frozen":
      return {
        what: t("doctor:explainFrozen", { seconds: num(m.seconds) }),
        check: t("doctor:checkFrozen"),
      };
    case "missing_audio":
      return {
        what: t("doctor:explainMissingAudio"),
        check: t("doctor:checkMissingAudio"),
      };
    case "silence":
      return {
        what: t("doctor:explainSilence", {
          seconds: num(m.seconds),
          db: num(m.thresholdDb),
        }),
        check: t("doctor:checkSilence"),
      };
    case "clipping":
      return {
        what: t("doctor:explainClipping", {
          peak: num(m.peakDb),
          db: num(m.thresholdDb),
        }),
        check: t("doctor:checkClipping"),
      };
    case "duration_mismatch":
      return {
        what:
          m.field === "timeline"
            ? t("doctor:explainDurationTimeline", {
                found: num(m.found),
                expected: num(m.expected),
              })
            : t("doctor:explainDurationAudio", {
                found: num(m.found),
                expected: num(m.expected),
              }),
        check: t("doctor:checkDuration"),
      };
    case "stream_mismatch":
      return {
        what:
          m.field === "codec"
            ? t("doctor:explainCodec", { codec: num(m.found) })
            : m.field === "variable_frame_rate"
              ? t("doctor:explainVariableRate", {
                  average: num(m.averageFps),
                  nominal: num(m.nominalFps),
                })
              : t("doctor:explainStream", {
                  field: num(m.field),
                  found: num(m.found),
                  expected: num(m.expected),
                }),
        check: t("doctor:checkStream"),
      };
    case "timeline_gap":
      return {
        what: t("doctor:explainTimelineGap", { seconds: num(m.seconds) }),
        check: t("doctor:checkTimelineGap"),
      };
  }
}

/** Why it has this severity, in terms of the timeline. */
function intentNote(issue: InspectionIssue): string {
  if (issue.intent === "possible") return t("doctor:intentPossible");
  if (issue.intent === "intended") {
    return (
      {
        still: t("doctor:intendedStill"),
        hold: t("doctor:intendedHold"),
        pose: t("doctor:intendedPose"),
        text: t("doctor:intendedText"),
      }[issue.context ?? ""] ?? t("doctor:intendedSilence")
    );
  }
  return (
    {
      narration: t("doctor:defectNarration"),
      music: t("doctor:defectMusic"),
      clip: t("doctor:defectClip"),
      "image-motion": t("doctor:defectImageMotion"),
      animation: t("doctor:defectAnimation"),
    }[issue.context ?? ""] ?? t("doctor:defectGeneral")
  );
}

/** m:ss.s: findings are measured to the frame, so whole seconds mislead. */
function precise(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = (seconds - minutes * 60).toFixed(1).padStart(4, "0");
  return `${minutes}:${rest}`;
}

const range = (issue: InspectionIssue) =>
  issue.start === null
    ? t("doctor:wholeFile")
    : `${precise(issue.start)}–${precise(issue.end ?? issue.start)}`;

function Timeline({
  report,
  issues,
  selected,
  onSelect,
}: {
  report: Inspection;
  issues: InspectionIssue[];
  selected: string | null;
  onSelect(id: string): void;
}) {
  const duration = report.overview?.durationSeconds ?? 0;
  if (duration <= 0) return null;
  const at = (seconds: number) =>
    `${Math.min(100, (seconds / duration) * 100)}%`;
  return (
    <div className="flex flex-col gap-1">
      <div className="relative h-9 overflow-hidden rounded-md border border-line bg-canvas">
        {report.scenes.map((scene) => (
          <div
            key={scene.sceneId}
            className="absolute inset-y-0 border-r border-line-strong/70 px-1 pt-0.5 text-[10px] text-fg-dim"
            style={{
              left: at(scene.start),
              width: `calc(${at(scene.end - scene.start)})`,
            }}
            title={
              scene.title || t("doctor:sceneNumber", { n: scene.index + 1 })
            }
          >
            <span className="truncate">{scene.index + 1}</span>
          </div>
        ))}
        {issues
          .filter((issue) => issue.start !== null)
          .map((issue) => (
            <button
              key={issue.id}
              type="button"
              aria-label={`${typeLabel(issue.type)} ${range(issue)}`}
              title={`${typeLabel(issue.type)} · ${range(issue)}`}
              onClick={() => onSelect(issue.id)}
              className={cx(
                "absolute bottom-1 h-3 min-w-1 rounded-sm opacity-80 hover:opacity-100",
                MARKER[issue.severity],
                selected === issue.id && "ring-2 ring-fg",
              )}
              style={{
                left: at(issue.start ?? 0),
                width: `max(4px, ${at((issue.end ?? issue.start ?? 0) - (issue.start ?? 0))})`,
              }}
            />
          ))}
      </div>
      <div className="flex justify-between text-[10px] text-fg-dim tabular-nums">
        <span>0:00</span>
        <span>{formatClock(duration)}</span>
      </div>
    </div>
  );
}

function IssueDetail({
  issue,
  report,
  videoUrl,
}: {
  issue: InspectionIssue;
  report: Inspection;
  videoUrl: string | null;
}) {
  const openProject = useStudio((state) => state.openProject);
  const openEpisode = useStudio((state) => state.openEpisode);
  const setTab = useStudio((state) => state.setTab);
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const { what, check } = explain(issue);
  const scene = report.scenes.find((item) => item.sceneId === issue.sceneId);
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line card-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={TONE[issue.severity]}>
          {severityLabel(issue.severity)}
        </Badge>
        <h3 className="text-ui font-semibold text-fg">
          {typeLabel(issue.type)}
        </h3>
        <span className="timecode text-xs text-fg-muted">
          {range(issue)}
          {issue.approximateTime && ` ${t("doctor:approximate")}`}
        </span>
      </div>
      <p className="text-xs leading-5 text-fg">{what}</p>
      <p className="text-xs leading-5 text-fg-muted">{intentNote(issue)}</p>
      <p className="text-xs leading-5 text-fg-muted">
        <span className="font-medium text-fg">{t("doctor:toCheck")} </span>
        {check}
      </p>
      {Object.keys(issue.measured).length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-2xs">
          {Object.entries(issue.measured).map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-fg-dim">{key}</dt>
              <dd className="text-fg-muted tabular-nums">{String(value)}</dd>
            </div>
          ))}
        </dl>
      )}
      {issue.frames.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {issue.frames.map((frame) => (
            <figure key={frame.file} className="flex flex-col gap-0.5">
              <img
                src={bridge.inspectionFrameUrl(frame.file)}
                alt={t("doctor:frameAt", { time: precise(frame.at) })}
                className="h-28 rounded border border-line object-contain"
              />
              <figcaption className="timecode text-[10px] text-fg-dim">
                {t("doctor:frameAt", { time: precise(frame.at) })}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      {issue.log.length > 0 && (
        <pre
          data-selectable
          className="max-h-28 overflow-auto rounded bg-canvas p-2 text-[10px] leading-4 text-fg-muted"
        >
          {issue.log.join("\n")}
        </pre>
      )}
      {playing && videoUrl && (
        <video
          ref={video}
          src={videoUrl}
          controls
          autoPlay
          className="max-h-64 rounded border border-line bg-black"
          onLoadedMetadata={(event) => {
            event.currentTarget.currentTime = Math.max(
              0,
              (issue.start ?? 0) - 1,
            );
          }}
        />
      )}
      <div className="flex flex-wrap gap-2">
        {issue.start !== null && videoUrl && (
          <Button size="sm" icon={Play} onClick={() => setPlaying(true)}>
            {t("doctor:playFromHere")}
          </Button>
        )}
        {issue.start !== null && !videoUrl && (
          <Button
            size="sm"
            icon={FileVideo}
            onClick={() => void bridge.openVideo(report.source.path)}
          >
            {t("doctor:openInPlayer", { time: precise(issue.start) })}
          </Button>
        )}
        {scene && report.source.projectId && report.source.episodeId && (
          <Button
            size="sm"
            icon={Clapperboard}
            onClick={async () => {
              await openProject(report.source.projectId ?? "");
              await openEpisode(report.source.episodeId ?? "", scene.sceneId);
              setTab("scenes");
            }}
          >
            {t("doctor:openScene", { n: scene.index + 1, title: scene.title })}
          </Button>
        )}
      </div>
    </div>
  );
}

function Report({
  report,
  exports,
}: {
  report: Inspection;
  exports: DoctorExport[];
}) {
  const job = useStudio((state) =>
    state.jobs.find((item) => item.id === report.jobId),
  );
  const cancelJob = useStudio((state) => state.cancelJob);
  const system = useStudio((state) => state.system);
  const [severities, setSeverities] = useState<IssueSeverity[]>([
    "critical",
    "warning",
    "review",
  ]);
  const [type, setType] = useState<IssueType | "all">("all");
  const [selected, setSelected] = useState<string | null>(null);
  const shown = report.issues.filter(
    (issue) =>
      severities.includes(issue.severity) &&
      (type === "all" || issue.type === type),
  );
  const exported = exports.find(
    (item) => item.renderId === report.source.renderId,
  );
  const videoUrl =
    exported && system
      ? bridge.renderUrl(
          { id: exported.renderId, path: exported.path } as RenderRecord,
          system.dataDir,
        )
      : null;
  const counts = Object.fromEntries(
    ISSUE_SEVERITIES.map((severity) => [
      severity,
      report.issues.filter((issue) => issue.severity === severity).length,
    ]),
  ) as Record<IssueSeverity, number>;
  const current =
    shown.find((issue) => issue.id === selected) ?? shown[0] ?? null;
  const running = report.status === "pending" || report.status === "running";
  const overview = report.overview;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold tracking-tight text-fg">
            {report.name}
          </h2>
          <p
            className="truncate text-xs text-fg-muted"
            title={report.source.path}
          >
            {report.source.kind === "export"
              ? t("doctor:sourceExport")
              : t("doctor:sourceFile")}{" "}
            · {formatDateTime(report.createdAt)}
          </p>
        </div>
        {running && job && isActiveJob(job) && (
          <Button
            size="sm"
            icon={X}
            disabled={job.cancelRequestedAt !== null}
            onClick={() => void cancelJob(job.id)}
          >
            {t("doctor:stop")}
          </Button>
        )}
      </header>

      {running && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-accent/30 bg-accent/5 p-3 text-xs text-fg-muted">
          <span>
            {report.status === "pending"
              ? t("doctor:waiting")
              : job?.stage === "extracting"
                ? t("doctor:stageExtracting")
                : job?.stage === "analyzing"
                  ? t("doctor:stageAnalyzing")
                  : t("doctor:stagePreflight")}
          </span>
          <ProgressBar
            value={report.status === "pending" ? 0 : (job?.progress ?? null)}
          />
        </div>
      )}
      {report.status === "failed" && (
        <p className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs text-fg">
          {t("doctor:failed", { message: report.error ?? "" })}
        </p>
      )}
      {(report.status === "cancelled" || report.status === "interrupted") && (
        <p className="rounded-lg border border-line bg-canvas p-3 text-xs text-fg-muted">
          {report.status === "cancelled"
            ? t("doctor:cancelled")
            : t("doctor:interrupted")}
        </p>
      )}

      {overview && (
        <>
          <p className="text-xs text-fg-muted tabular-nums">
            {[
              overview.durationSeconds !== null
                ? formatClock(overview.durationSeconds)
                : null,
              overview.width && overview.height
                ? `${overview.width}×${overview.height}`
                : null,
              overview.fps
                ? `${Math.round(overview.fps * 100) / 100} fps`
                : null,
              overview.videoCodec,
              overview.audioCodec ?? t("doctor:noAudioStream"),
              overview.framesDecoded !== null
                ? t("doctor:framesDecoded", { count: overview.framesDecoded })
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <p className="text-2xs leading-4 text-fg-dim">
            {overview.timeline
              ? t("doctor:withTimeline")
              : t("doctor:withoutTimeline")}
          </p>
          <div
            className="flex flex-wrap gap-1.5"
            role="group"
            aria-label={t("doctor:filterSeverity")}
          >
            {ISSUE_SEVERITIES.map((severity) => {
              const on = severities.includes(severity);
              return (
                <button
                  key={severity}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setSeverities((list) =>
                      on
                        ? list.filter((s) => s !== severity)
                        : [...list, severity],
                    )
                  }
                  className={cx(
                    "flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
                    on
                      ? "border-line-strong bg-raised text-fg"
                      : "border-line text-fg-dim",
                  )}
                >
                  <span
                    className={cx("size-2 rounded-full", MARKER[severity])}
                    aria-hidden
                  />
                  {severityLabel(severity)} {counts[severity]}
                </button>
              );
            })}
            <select
              aria-label={t("doctor:filterType")}
              className="control h-7 w-auto text-xs"
              value={type}
              onChange={(event) =>
                setType(event.target.value as IssueType | "all")
              }
            >
              <option value="all">{t("doctor:allTypes")}</option>
              {ISSUE_TYPES.filter((item) =>
                report.issues.some((issue) => issue.type === item),
              ).map((item) => (
                <option key={item} value={item}>
                  {typeLabel(item)}
                </option>
              ))}
            </select>
          </div>
          <Timeline
            report={report}
            issues={shown}
            selected={current?.id ?? null}
            onSelect={setSelected}
          />
          {report.issues.length === 0 ? (
            <p className="text-xs text-ok">{t("doctor:nothingFound")}</p>
          ) : shown.length === 0 ? (
            <p className="text-xs text-fg-dim">{t("doctor:nothingMatches")}</p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <ol className="flex max-h-[520px] flex-col divide-y divide-line overflow-y-auto rounded-xl border border-line card-surface">
                {shown.map((issue) => (
                  <li key={issue.id}>
                    <button
                      type="button"
                      aria-current={
                        issue.id === current?.id ? "true" : undefined
                      }
                      onClick={() => setSelected(issue.id)}
                      className={cx(
                        "flex w-full items-center gap-2 px-3 py-2 text-left text-xs",
                        issue.id === current?.id
                          ? "bg-accent/10"
                          : "hover:bg-white/[0.04]",
                      )}
                    >
                      <span
                        className={cx(
                          "size-2 shrink-0 rounded-full",
                          MARKER[issue.severity],
                        )}
                        aria-hidden
                      />
                      <span className="timecode w-24 shrink-0 text-fg-muted">
                        {range(issue)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-fg">
                        {typeLabel(issue.type)}
                      </span>
                      {issue.sceneIndex !== null && (
                        <span className="shrink-0 text-2xs text-fg-dim">
                          {t("doctor:sceneNumber", { n: issue.sceneIndex + 1 })}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ol>
              {current && (
                <IssueDetail
                  key={current.id}
                  issue={current}
                  report={report}
                  videoUrl={videoUrl}
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function DoctorView() {
  const notify = useStudio((state) => state.notify);
  const jobs = useStudio((state) => state.jobs);
  const [exports, setExports] = useState<DoctorExport[]>([]);
  const [reports, setReports] = useState<Inspection[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [listedExports, listedReports] = await Promise.all([
        bridge.call("doctor.exports", {}),
        bridge.call("doctor.list", {}),
      ]);
      setExports(listedExports);
      setReports(listedReports);
    } catch (error) {
      notify("error", errorMessage(error, t("doctor:couldNotLoad")));
    }
  }, [notify]);

  // Reports follow their jobs: reload whenever one changes state.
  const signature = useMemo(
    () =>
      jobs
        .filter((job) => job.type === "video_inspection")
        .map((job) => `${job.id}:${job.status}:${job.stage ?? ""}`)
        .join("|"),
    [jobs],
  );
  useEffect(() => {
    void load();
  }, [load, signature]);

  const inspect = async (
    source:
      { kind: "export"; renderId: string } | { kind: "file"; path: string },
  ) => {
    setStarting(true);
    try {
      const created = await bridge.call("doctor.inspect", { source });
      setSelected(created.id);
      await load();
    } catch (error) {
      notify("error", errorMessage(error, t("doctor:couldNotStart")));
    } finally {
      setStarting(false);
    }
  };

  const report =
    reports.find((item) => item.id === selected) ?? reports[0] ?? null;

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-r border-line p-4">
        <div className="flex items-center gap-2">
          <Stethoscope className="size-4 text-accent" aria-hidden />
          <h1 className="text-ui font-semibold text-fg">{t("doctor:title")}</h1>
        </div>
        <p className="text-2xs leading-4 text-fg-dim">{t("doctor:intro")}</p>
        <Button
          variant="primary"
          icon={FileVideo}
          busy={starting}
          onClick={async () => {
            const [path] = await bridge.chooseMediaFiles(["video"], false);
            if (path) await inspect({ kind: "file", path });
          }}
        >
          {t("doctor:inspectFile")}
        </Button>
        <section className="flex flex-col gap-1.5">
          <h2 className="eyebrow">{t("doctor:exports")}</h2>
          {exports.length === 0 ? (
            <p className="text-2xs text-fg-dim">{t("doctor:noExports")}</p>
          ) : (
            exports.slice(0, 12).map((item) => (
              <button
                key={item.renderId}
                type="button"
                disabled={starting}
                onClick={() =>
                  void inspect({ kind: "export", renderId: item.renderId })
                }
                className="flex flex-col rounded-md border border-line px-2 py-1.5 text-left hover:border-accent/60"
                title={t("doctor:inspectExport")}
              >
                <span className="truncate text-xs text-fg">
                  {item.projectName} · {item.episodeTitle}
                </span>
                <span className="text-2xs text-fg-dim tabular-nums">
                  {formatClock(item.durationSeconds)} ·{" "}
                  {formatDateTime(item.createdAt)}
                </span>
              </button>
            ))
          )}
        </section>
        <section className="flex flex-col gap-1.5">
          <h2 className="eyebrow">{t("doctor:history")}</h2>
          {reports.length === 0 ? (
            <p className="text-2xs text-fg-dim">{t("doctor:noReports")}</p>
          ) : (
            reports.map((item) => {
              const worst = ISSUE_SEVERITIES.find((severity) =>
                item.issues.some((issue) => issue.severity === severity),
              );
              return (
                <div
                  key={item.id}
                  className={cx(
                    "group flex items-center gap-2 rounded-md border px-2 py-1.5",
                    item.id === report?.id
                      ? "border-accent/50 bg-accent/10"
                      : "border-line",
                  )}
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 flex-col text-left"
                    onClick={() => setSelected(item.id)}
                  >
                    <span className="truncate text-xs text-fg">
                      {item.name}
                    </span>
                    <span className="flex items-center gap-1.5 text-2xs text-fg-dim">
                      {item.status === "completed" && worst ? (
                        <span
                          className={cx("size-2 rounded-full", MARKER[worst])}
                          aria-hidden
                        />
                      ) : null}
                      {item.status === "completed"
                        ? t("doctor:findings", {
                            count: item.issues.filter(
                              (issue) => issue.severity !== "info",
                            ).length,
                          })
                        : statusLabel(item.status)}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={t("doctor:deleteReport")}
                    disabled={
                      item.status === "pending" || item.status === "running"
                    }
                    className="rounded p-1 text-fg-dim opacity-0 group-hover:opacity-100 hover:text-danger disabled:hidden"
                    onClick={async () => {
                      try {
                        await bridge.call("doctor.delete", { id: item.id });
                        await load();
                      } catch (error) {
                        notify(
                          "error",
                          errorMessage(error, t("doctor:couldNotDelete")),
                        );
                      }
                    }}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                </div>
              );
            })
          )}
        </section>
      </aside>
      <div className="min-w-0 flex-1 overflow-y-auto p-6">
        {report ? (
          <Report key={report.id} report={report} exports={exports} />
        ) : (
          <EmptyState
            icon={Stethoscope}
            title={t("doctor:emptyTitle")}
            description={t("doctor:emptyText")}
          />
        )}
      </div>
    </div>
  );
}
