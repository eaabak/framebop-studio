/**
 * Rendering the open episode to an MP4 file: export settings, background
 * music, the renderer's real state, what the plan will do, live progress and
 * every finished render with the results of its checks.
 */
import {
  type AppSettings,
  type Job,
  type RenderRecord,
  formatDuration,
  isActiveJob,
} from "@framebop/core";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Film,
  FolderOpen,
  Music,
  Play,
  RefreshCw,
  Trash2,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Field,
  ProgressBar,
  Spinner,
  cx,
} from "../components/ui";
import { VideoFormatPicker } from "../components/VideoFormatPicker";
import { bridge } from "../lib/bridge";
import { useStudio } from "../store/studio";
import { currentLanguage, formatBytes, t } from "../i18n";
import { jobLabel, noticeText, progressText } from "../lib/jobLabels";

function SettingsCard() {
  const settings = useStudio((state) => state.settings);
  const system = useStudio((state) => state.system);
  const updateSettings = useStudio((state) => state.updateSettings);
  const refreshRenders = useStudio((state) => state.refreshRenders);
  const changeExportDirectory = useStudio(
    (state) => state.changeExportDirectory,
  );
  const notify = useStudio((state) => state.notify);
  const change = async (patch: Partial<AppSettings>) => {
    await updateSettings(patch);
    void refreshRenders();
  };
  const folder =
    settings.exportDirectory ??
    (system
      ? `${system.dataDir}${system.dataDir.includes("\\") ? "\\" : "/"}exports`
      : "");

  return (
    <div className="flex flex-col gap-4 card-surface rounded-xl border p-4">
      <VideoFormatPicker />
      <div className="grid grid-cols-3 gap-3">
        <Field label={t("production:resolution")}>
          {(id) => (
            <select
              id={id}
              className="control"
              value={settings.exportResolution}
              onChange={(event) =>
                void change({
                  exportResolution: event.target
                    .value as AppSettings["exportResolution"],
                })
              }
            >
              <option value="1920x1080">1920 × 1080 · 16:9</option>
              <option value="1280x720">1280 × 720 · 16:9</option>
              <option value="1080x1920">1080 × 1920 · 9:16</option>
            </select>
          )}
        </Field>
        <Field
          label={t("production:frameRate")}
          hint={settings.exportFps === 60 ? t("video:export60Hint") : undefined}
        >
          {(id) => (
            <select
              id={id}
              className="control"
              value={settings.exportFps}
              onChange={(event) =>
                void change({
                  exportFps: Number(
                    event.target.value,
                  ) as AppSettings["exportFps"],
                })
              }
            >
              <option value={24}>{t("production:n24Fps")}</option>
              <option value={25}>{t("production:n25Fps")}</option>
              <option value={30}>{t("production:n30Fps")}</option>
              <option value={60}>60 FPS</option>
            </select>
          )}
        </Field>
        <Field
          label={t("production:captions")}
          hint={
            settings.exportCaptions === "approximate"
              ? t("production:timedBySentenceLengthNotBy")
              : undefined
          }
        >
          {(id) => (
            <select
              id={id}
              className="control"
              value={settings.exportCaptions}
              onChange={(event) =>
                void change({
                  exportCaptions: event.target
                    .value as AppSettings["exportCaptions"],
                })
              }
            >
              <option value="none">{t("production:none")}</option>
              <option value="approximate">
                {t("production:narrationTextApproximate")}
              </option>
            </select>
          )}
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-fg-muted">
            {t("production:outputFolder")}
          </div>
          <div
            data-selectable
            className="truncate text-xs text-fg"
            title={folder}
          >
            {folder}
          </div>
          <div className="text-2xs text-fg-dim">
            {settings.exportDirectory
              ? t("production:chosenByYou")
              : t("production:defaultInsideTheLibraryFolder")}{" "}
            {t("production:existingFilesAreNeverReplaced")}
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          icon={FolderOpen}
          disabled={!folder}
          onClick={() =>
            void bridge
              .revealInFileManager(folder)
              .catch(() =>
                notify("error", t("production:theFolderCouldNotBeOpened")),
              )
          }
        >
          {t("production:show")}
        </Button>
        <Button size="sm" onClick={() => void changeExportDirectory(false)}>
          {t("production:change")}
        </Button>
        {settings.exportDirectory && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void changeExportDirectory(true)}
          >
            {t("production:useDefault")}
          </Button>
        )}
      </div>
    </div>
  );
}

function MusicCard() {
  const episode = useStudio((state) => state.episode);
  const music = useStudio((state) =>
    state.episode?.musicAssetId
      ? (state.assets[state.episode.musicAssetId] ?? null)
      : null,
  );
  const importing = useStudio((state) =>
    state.jobs.some(
      (job) =>
        job.type === "media_import" &&
        job.episodeId === state.activeEpisodeId &&
        job.sceneId === null &&
        isActiveJob(job),
    ),
  );
  const importMusic = useStudio((state) => state.importMusic);
  const removeMusic = useStudio((state) => state.removeMusic);
  const setMusicVolume = useStudio((state) => state.setMusicVolume);
  const [volume, setVolume] = useState(episode?.musicVolume ?? 0.15);
  useEffect(
    () => setVolume(episode?.musicVolume ?? 0.15),
    [episode?.musicVolume],
  );
  if (!episode) return null;

  return (
    <div className="flex flex-col gap-3 card-surface rounded-xl border p-4">
      <div className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-raised text-fg-dim">
          <Music className="size-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-ui font-medium text-fg">
            {t("production:backgroundMusic")}
          </div>
          <div className="truncate text-xs text-fg-muted">
            {importing
              ? t("production:importing")
              : music
                ? `${music.originalFilename}${music.durationSeconds ? ` · ${formatDuration(music.durationSeconds)}` : ""}. Repeats to fill the video, fades in and out.`
                : t("production:noneOptionalOneAudioFileUnder")}
          </div>
        </div>
        <Button
          size="sm"
          icon={Upload}
          busy={importing}
          onClick={() => void importMusic()}
        >
          {music ? t("production:replace") : t("production:import")}
        </Button>
        {music && (
          <Button
            size="sm"
            variant="ghost"
            icon={X}
            onClick={() => void removeMusic()}
          >
            {t("production:remove")}
          </Button>
        )}
      </div>
      {music && (
        <div className="flex items-center gap-3">
          <label htmlFor="music-volume" className="text-xs text-fg-muted">
            {t("production:volume")}
          </label>
          <input
            id="music-volume"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(event) => setVolume(Number(event.target.value))}
            onPointerUp={() => void setMusicVolume(volume)}
            onKeyUp={() => void setMusicVolume(volume)}
            className="flex-1 accent-accent"
          />
          <span className="w-10 text-right text-xs text-fg-muted tabular-nums">
            {Math.round(volume * 100)}%
          </span>
          <audio
            controls
            preload="metadata"
            src={bridge.mediaUrl(music, "file")}
            className="h-8 w-56"
          />
        </div>
      )}
    </div>
  );
}

function RendererStatus() {
  const engines = useStudio((state) => state.engines);
  const enginesState = useStudio((state) => state.enginesState);
  const refreshEngines = useStudio((state) => state.refreshEngines);
  const chooseProgram = useStudio((state) => state.chooseProgram);
  const remotion = engines.find((engine) => engine.id === "remotion");
  const ffmpeg = engines.find((engine) => engine.id === "ffmpeg");
  if (!remotion) {
    return enginesState === "ready" ? (
      <p className="text-xs text-danger">
        {t("production:thisBuildHasNoVideoRenderer")}
      </p>
    ) : (
      <Spinner />
    );
  }
  const ready = remotion.state === "available";
  const ffmpegReady = ffmpeg?.state === "available";
  if (ready && ffmpegReady) return null;
  const reason = remotion.capabilities[0]?.reason ?? remotion.summary;
  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-lg border border-warn/30 bg-warn/10 p-3 text-xs leading-5 text-fg"
    >
      {!ready && (
        <p>
          <strong className="font-semibold">
            {t("production:remotionCannotRenderYet")}
          </strong>{" "}
          {reason}
        </p>
      )}
      {!ffmpegReady && (
        <p>
          <strong className="font-semibold">
            {t("production:ffmpegWasNotFound")}
          </strong>{" "}
          {t("production:itIsNeededToCheckEvery")}
        </p>
      )}
      <div className="flex gap-2">
        {!ready && /Chrome|browser/i.test(reason) && (
          <Button
            size="sm"
            onClick={() => void chooseProgram("rendererBrowserPath")}
          >
            {t("production:chooseAChromeBuild")}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          icon={RefreshCw}
          busy={enginesState === "loading"}
          onClick={() => void refreshEngines()}
        >
          {t("production:checkAgain")}
        </Button>
      </div>
    </div>
  );
}

const BUILD_STAGES = [
  "preflight",
  "preparing",
  "composing",
  "rendering",
  "verifying",
] as const;

/** Preflight → preparing → composing → rendering → verifying. */
function BuildStages({ job }: { job: Job }) {
  const reached =
    job.status === "pending"
      ? -1
      : BUILD_STAGES.indexOf(job.stage as (typeof BUILD_STAGES)[number]);
  const label = {
    preflight: t("assembly:stagePreflight"),
    preparing: t("assembly:stagePreparing"),
    composing: t("assembly:stageComposing"),
    rendering: t("assembly:stageRendering"),
    verifying: t("assembly:stageVerifying"),
  };
  return (
    <ol className="flex flex-wrap gap-1 text-2xs">
      {BUILD_STAGES.map((stage, index) => (
        <li
          key={stage}
          aria-current={index === reached ? "step" : undefined}
          className={cx(
            "rounded px-1.5 py-0.5",
            index === reached
              ? "bg-accent/15 font-medium text-accent"
              : index < reached
                ? "text-fg-muted"
                : "text-fg-dim",
          )}
        >
          {label[stage]}
        </li>
      ))}
    </ol>
  );
}

function ActiveRender({ job }: { job: Job }) {
  const cancelJob = useStudio((state) => state.cancelJob);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-accent/40 bg-accent/5 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-ui font-semibold text-fg">
            {jobLabel(job.label)}
          </div>
          <div className="text-xs text-fg-muted">
            {job.status === "pending"
              ? t("production:waitingForTheJobBeforeIt")
              : job.progressMessage
                ? progressText(job.progressMessage)
                : t("production:starting")}
          </div>
        </div>
        <Button
          icon={X}
          disabled={job.cancelRequestedAt !== null}
          onClick={() => void cancelJob(job.id)}
        >
          {job.cancelRequestedAt
            ? t("production:stopping")
            : t("production:stop")}
        </Button>
      </div>
      <BuildStages job={job} />
      <ProgressBar value={job.status === "pending" ? 0 : job.progress} />
      {job.progress !== null && (
        <div className="text-right text-2xs text-fg-muted tabular-nums">
          {Math.floor(job.progress * 100)}%
        </div>
      )}
    </div>
  );
}

const CHECK_ICON = {
  pass: CheckCircle2,
  warning: AlertTriangle,
  fail: XCircle,
};
const CHECK_TONE = {
  pass: "text-ok",
  warning: "text-warn",
  fail: "text-danger",
};

function Checks({ checks }: { checks: RenderRecord["validation"]["checks"] }) {
  return (
    <ul className="flex flex-col gap-1">
      {checks.map((check) => {
        const Icon = CHECK_ICON[check.result];
        return (
          <li key={check.label} className="flex gap-2 text-xs">
            <Icon
              className={cx(
                "mt-0.5 size-3.5 shrink-0",
                CHECK_TONE[check.result],
              )}
              aria-hidden
            />
            <span>
              <span className="text-fg">{check.label}:</span>{" "}
              <span className="text-fg-muted">{check.detail}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function RenderRow({
  render,
  current,
}: {
  render: RenderRecord;
  current: boolean;
}) {
  const system = useStudio((state) => state.system);
  const openRender = useStudio((state) => state.openRender);
  const revealRender = useStudio((state) => state.revealRender);
  const forgetRender = useStudio((state) => state.forgetRender);
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const url = system ? bridge.renderUrl(render, system.dataDir) : null;
  const present = render.fileStatus === "present";
  const warnings = render.validation.checks.filter(
    (c) => c.result !== "pass",
  ).length;

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-expanded={open}
          aria-label={
            open ? t("production:hideChecks") : t("production:showChecks")
          }
          onClick={() => setOpen(!open)}
          className="text-fg-dim hover:text-fg"
        >
          {open ? (
            <ChevronDown className="size-4" aria-hidden />
          ) : (
            <ChevronRight className="size-4" aria-hidden />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-ui font-medium text-fg">
              {new Date(render.createdAt).toLocaleString(currentLanguage())}
            </span>
            {render.validation.passed ? (
              <Badge tone={warnings ? "warn" : "ok"}>
                {warnings
                  ? t("production:checkedWithWarnings", { count: warnings })
                  : t("production:checked")}
              </Badge>
            ) : (
              <Badge tone="danger">{t("production:failedChecks")}</Badge>
            )}
            {current && (
              <Badge tone="accent">
                {t("production:matchesTheCurrentEdit")}
              </Badge>
            )}
            {render.fileStatus === "missing" && (
              <Badge tone="danger">{t("production:fileMissing")}</Badge>
            )}
            {render.fileStatus === "changed" && (
              <Badge tone="warn">{t("production:fileChanged")}</Badge>
            )}
          </div>
          <div
            className="truncate text-2xs text-fg-dim"
            title={render.path}
            data-selectable
          >
            {t("production:fps", {
              width: render.width,
              height: render.height,
              fps: render.fps,
              durationSeconds: formatDuration(render.durationSeconds),
              sizeBytes: formatBytes(render.sizeBytes),
              path: render.path,
            })}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            icon={Play}
            disabled={!present || !url}
            title={
              !present
                ? t("production:theFileIsNotThereAny")
                : url
                  ? undefined
                  : t("production:previewsInsideTheAppWorkFor")
            }
            onClick={() => setPlaying(!playing)}
          >
            {playing ? t("production:hide") : t("production:preview")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={ExternalLink}
            disabled={!present || !bridge.native}
            title={
              bridge.native
                ? t("production:openInYourVideoPlayer")
                : t("production:availableInTheDesktopApp")
            }
            onClick={() => void openRender(render)}
          >
            {t("production:open")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={FolderOpen}
            disabled={!present || !bridge.native}
            title={
              bridge.native
                ? undefined
                : t("production:availableInTheDesktopApp")
            }
            onClick={() => void revealRender(render)}
          >
            {t("production:show")}
          </Button>
          <Button
            size="sm"
            variant="danger"
            icon={Trash2}
            title={t("production:removeFromThisListTheFile")}
            onClick={() => void forgetRender(render.id)}
          >
            {t("production:forget")}
          </Button>
        </div>
      </div>
      {playing && url && (
        <video
          controls
          autoPlay
          src={url}
          className="w-full rounded-md bg-black"
        />
      )}
      {open && (
        <div className="rounded-md border border-line bg-canvas/40 p-3">
          <Checks checks={render.validation.checks} />
          <p className="mt-2 text-2xs text-fg-dim">
            {t("production:checkedWithAfterRendering", {
              inspector: render.validation.inspector,
            })}
          </p>
        </div>
      )}
    </li>
  );
}

export function RenderSection() {
  const activeEpisodeId = useStudio((state) => state.activeEpisodeId);
  const preview = useStudio((state) => state.renderPreview);
  const renders = useStudio((state) => state.renders);
  const renderState = useStudio((state) => state.renderState);
  const saveState = useStudio((state) => state.saveState);
  const engines = useStudio((state) => state.engines);
  const refreshRenders = useStudio((state) => state.refreshRenders);
  const startRender = useStudio((state) => state.startRender);
  const jobs = useStudio((state) => state.jobs);
  const [starting, setStarting] = useState(false);

  // The plan follows the edit: refresh once changes are stored.
  useEffect(() => {
    if (saveState === "saved") void refreshRenders();
  }, [activeEpisodeId, saveState, refreshRenders]);

  const renderJobs = jobs.filter(
    (job) => job.type === "video_render" && job.episodeId === activeEpisodeId,
  );
  const active = renderJobs.find(isActiveJob);
  const lastEnded = renderJobs.find((job) => !isActiveJob(job));
  const failed =
    lastEnded && lastEnded.status !== "completed" ? lastEnded : null;
  const failedChecks = (
    failed?.metadata.validation as RenderRecord["validation"] | undefined
  )?.checks;

  const remotionReady =
    engines.find((engine) => engine.id === "remotion")?.state === "available";
  const ffmpegReady =
    engines.find((engine) => engine.id === "ffmpeg")?.state === "available";
  const errors = preview?.notices.filter((n) => n.severity === "error") ?? [];
  const warnings =
    preview?.notices.filter((n) => n.severity === "warning") ?? [];
  const blocker = !remotionReady
    ? t("production:theRendererIsNotSetUp")
    : !ffmpegReady
      ? t("production:ffmpegIsNeededToCheckThe")
      : errors.length > 0
        ? t("production:fixTheProblemsListedAboveFirst")
        : active
          ? t("production:thisEpisodeIsAlreadyRendering")
          : null;

  const sceneCount = useStudio((state) => state.scenes.length);
  const system = useStudio((state) => state.system);
  const openRender = useStudio((state) => state.openRender);
  const revealRender = useStudio((state) => state.revealRender);
  // The newest video that is still on disk: the one to watch and save.
  const latest = renders.find((render) => render.fileStatus === "present");
  const upToDate =
    latest !== undefined && latest.planHash === preview?.planHash;
  const url =
    latest && system ? bridge.renderUrl(latest, system.dataDir) : null;

  return (
    <section aria-labelledby="video-heading" className="flex flex-col gap-3">
      <div className="flex flex-col gap-4 card-surface rounded-2xl border p-5">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-accent/30 bg-accent/10 text-accent">
            <Film className="size-6" strokeWidth={1.5} aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h2
              id="video-heading"
              className="text-base font-semibold tracking-tight text-fg"
            >
              {t("production:makeVideoTitle")}
            </h2>
            <p className="mt-0.5 text-xs leading-5 text-fg-muted">
              {preview?.plan
                ? t("production:makeVideoSummary", {
                    count: sceneCount,
                    duration: formatDuration(preview.durationSeconds),
                    width: preview.plan.width,
                    height: preview.plan.height,
                  })
                : t("production:makeVideoHint")}
            </p>
          </div>
          <Button
            variant="primary"
            icon={Film}
            className="h-10 px-5 text-sm"
            busy={starting}
            disabled={blocker !== null || renderState === "loading"}
            title={blocker ?? undefined}
            onClick={async () => {
              setStarting(true);
              await startRender();
              setStarting(false);
            }}
          >
            {latest
              ? t("production:makeVideoAgain")
              : t("production:makeVideo")}
          </Button>
        </div>
        {(errors.length > 0 || warnings.length > 0) && (
          <ul className="flex flex-col gap-1 border-t border-line pt-3">
            {[...errors, ...warnings].map((notice) => (
              <li key={notice.message} className="flex gap-2 text-xs">
                {notice.severity === "error" ? (
                  <XCircle
                    className="mt-0.5 size-3.5 shrink-0 text-danger"
                    aria-hidden
                  />
                ) : (
                  <AlertTriangle
                    className="mt-0.5 size-3.5 shrink-0 text-warn"
                    aria-hidden
                  />
                )}
                <span className="text-fg-muted">
                  {noticeText(notice.message)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {blocker && !active && (
          <p className="text-xs text-fg-muted">{blocker}</p>
        )}
        {active && <ActiveRender job={active} />}
        {failed && !active && (
          <div className="flex flex-col gap-2 rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs leading-5">
            <p className="text-fg">
              <strong className="font-semibold">
                {failed.status === "cancelled"
                  ? t("production:lastRenderStopped")
                  : failed.status === "interrupted"
                    ? t("production:lastRenderInterrupted")
                    : t("production:lastRenderFailed")}
              </strong>{" "}
              {t("production:renderAgainToStartOverWith", {
                message: failed.error?.message,
              })}
            </p>
            {failedChecks && <Checks checks={failedChecks} />}
          </div>
        )}

        {latest && !active && (
          <div className="flex flex-col gap-2 border-t border-line pt-4">
            <p
              className={cx(
                "flex items-center gap-1.5 text-xs font-medium",
                upToDate ? "text-ok" : "text-warn",
              )}
            >
              {upToDate ? (
                <CheckCircle2 className="size-4" aria-hidden />
              ) : (
                <AlertTriangle className="size-4" aria-hidden />
              )}
              {upToDate
                ? t("production:videoReady")
                : t("production:videoOutdated")}
            </p>
            {url && (
              <video
                controls
                src={url}
                className="w-full rounded-lg bg-black"
              />
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                icon={ExternalLink}
                disabled={!bridge.native}
                title={
                  bridge.native
                    ? t("production:openInYourVideoPlayer")
                    : t("production:availableInTheDesktopApp")
                }
                onClick={() => void openRender(latest)}
              >
                {t("production:open")}
              </Button>
              <Button
                icon={FolderOpen}
                disabled={!bridge.native}
                title={
                  bridge.native
                    ? undefined
                    : t("production:availableInTheDesktopApp")
                }
                onClick={() => void revealRender(latest)}
              >
                {t("production:showInFolder")}
              </Button>
            </div>
          </div>
        )}
      </div>
      <MusicCard />
    </section>
  );
}

/**
 * Everything else about the video, for those who want it: whether the
 * renderer is ready, the output settings and every video made so far.
 */
export function RenderAdvanced() {
  const renders = useStudio((state) => state.renders);
  const preview = useStudio((state) => state.renderPreview);
  return (
    <section
      aria-labelledby="video-advanced-heading"
      className="flex flex-col gap-3"
    >
      <h2 id="video-advanced-heading" className="eyebrow">
        {t("production:finalVideo")}
      </h2>
      <RendererStatus />
      <SettingsCard />
      {renders.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden card-surface rounded-xl border">
          {renders.map((render) => (
            <RenderRow
              key={render.id}
              render={render}
              current={render.planHash === preview?.planHash}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
