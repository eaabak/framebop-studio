import { formatDuration } from "@framebop/core";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  ChevronRight,
  FileJson,
} from "lucide-react";
import { useState } from "react";
import { sceneLabel } from "../components/media";
import { Button, ErrorState, Spinner } from "../components/ui";
import { useStudio } from "../store/studio";
import { AssemblyTimeline } from "./AssemblyTimeline";
import { RenderAdvanced, RenderSection } from "./RenderSection";
import { NoEpisode } from "./ScenesView";
import { t } from "../i18n";

interface Check {
  label: string;
  detail: string;
  state: "ok" | "warn" | "todo";
  /** Indices of scenes that still need attention for this check. */
  missing: number[];
}

const CHECK_ICONS = {
  ok: CheckCircle2,
  warn: AlertTriangle,
  todo: CircleDashed,
};
const CHECK_TONES = { ok: "text-ok", warn: "text-warn", todo: "text-fg-dim" };

export function ExportView() {
  const episode = useStudio((state) => state.episode);
  const episodeState = useStudio((state) => state.episodeState);
  const episodeError = useStudio((state) => state.episodeError);
  const activeEpisodeId = useStudio((state) => state.activeEpisodeId);
  const scenes = useStudio((state) => state.scenes);
  const targetSeconds = useStudio(
    (state) =>
      state.projects.find((project) => project.id === state.activeProjectId)
        ?.targetDurationSeconds ?? 0,
  );
  const selectScene = useStudio((state) => state.selectScene);
  const setTab = useStudio((state) => state.setTab);
  const openEpisode = useStudio((state) => state.openEpisode);
  const exportManifest = useStudio((state) => state.exportManifest);
  const [exporting, setExporting] = useState(false);

  if (!activeEpisodeId) return <NoEpisode purpose={t("production:exportIt")} />;
  if (episodeState === "error") {
    return (
      <ErrorState
        message={episodeError ?? t("production:theEpisodeCouldNotBeLoaded")}
        onRetry={() => void openEpisode(activeEpisodeId)}
      />
    );
  }
  if (!episode) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-5" />
      </div>
    );
  }

  const indicesWhere = (
    predicate: (scene: (typeof scenes)[number]) => boolean,
  ) => scenes.flatMap((scene, index) => (predicate(scene) ? [index] : []));
  const total = scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
  const noVisual = indicesWhere(
    (scene) => !scene.videoAssetId && !scene.imageAssetId,
  );
  const noClip = indicesWhere((scene) => !scene.videoAssetId);
  const noAudio = indicesWhere((scene) => !scene.audioAssetId);
  const difference = total - targetSeconds;

  const checks: Check[] = [
    {
      label: t("production:scenes"),
      detail:
        scenes.length === 0
          ? t("production:theEpisodeHasNoScenes")
          : t("production:scenesInTotal", {
              scenes: scenes.length,
              total: formatDuration(total),
            }),
      state: scenes.length === 0 ? "todo" : "ok",
      missing: [],
    },
    {
      label: t("production:lengthAgainstTarget"),
      detail:
        scenes.length === 0
          ? t("production:targetIs", {
              targetSeconds: formatDuration(targetSeconds),
            })
          : Math.abs(difference) <= targetSeconds * 0.05
            ? t("production:within5OfTheTarget", {
                targetSeconds: formatDuration(targetSeconds),
              })
            : t(
                difference > 0
                  ? "production:overTarget"
                  : "production:underTarget",
                {
                  amount: formatDuration(Math.abs(difference)),
                  target: formatDuration(targetSeconds),
                },
              ),
      state:
        scenes.length === 0
          ? "todo"
          : Math.abs(difference) <= targetSeconds * 0.05
            ? "ok"
            : "warn",
      missing: [],
    },
    {
      label: t("production:everySceneHasAPicture"),
      detail:
        noVisual.length === 0
          ? t("production:allScenesHaveAnImageOr")
          : t("production:scenesWithoutVisual", { count: noVisual.length }),
      state:
        scenes.length === 0 ? "todo" : noVisual.length === 0 ? "ok" : "warn",
      missing: noVisual,
    },
    {
      label: t("production:everySceneIsAnimated"),
      detail:
        noClip.length === 0
          ? t("production:allScenesHaveAVideoClip")
          : t("production:scenesShownAsStill", { count: noClip.length }),
      state: scenes.length === 0 ? "todo" : noClip.length === 0 ? "ok" : "todo",
      missing: noClip,
    },
    {
      label: t("production:everySceneHasNarrationAudio"),
      detail:
        noAudio.length === 0
          ? t("production:allScenesHaveAudio")
          : t("production:scenesWithoutAudio", { count: noAudio.length }),
      state:
        scenes.length === 0 ? "todo" : noAudio.length === 0 ? "ok" : "todo",
      missing: noAudio,
    },
  ];

  const jumpTo = (index: number) => {
    const scene = scenes[index];
    if (!scene) return;
    selectScene(scene.id);
    setTab("scenes");
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-8 p-6">
        <header>
          <h1 className="text-lg font-semibold tracking-tight text-fg">
            {t("production:export")}
          </h1>
          <p className="text-xs text-fg-muted">“{episode.title}”</p>
        </header>

        <RenderSection />

        <details className="group card-surface rounded-xl border">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 select-none">
            <ChevronRight
              className="size-4 text-fg-dim transition-transform group-open:rotate-90"
              aria-hidden
            />
            <span className="text-ui font-medium text-fg">
              {t("production:advanced")}
            </span>
            <span className="min-w-0 truncate text-2xs text-fg-dim">
              {t("production:advancedHint")}
            </span>
          </summary>
          <div className="flex flex-col gap-8 border-t border-line p-4">
            <section aria-labelledby="readiness-heading">
              <h2 id="readiness-heading" className="eyebrow mb-3">
                {t("production:readiness")}
              </h2>
              <ul className="divide-y divide-line overflow-hidden card-surface rounded-xl border">
                {checks.map((check) => {
                  const Icon = CHECK_ICONS[check.state];
                  return (
                    <li key={check.label} className="flex gap-3 p-3.5">
                      <Icon
                        className={`mt-0.5 size-4 shrink-0 ${CHECK_TONES[check.state]}`}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <h3 className="text-ui font-medium text-fg">
                          {check.label}
                        </h3>
                        <p className="text-xs text-fg-muted">{check.detail}</p>
                        {check.missing.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {check.missing.slice(0, 24).map((index) => (
                              <button
                                key={index}
                                type="button"
                                title={sceneLabel(
                                  scenes[index] ?? { title: "" },
                                  index,
                                )}
                                onClick={() => jumpTo(index)}
                                className="timecode rounded border border-line-strong bg-raised px-1.5 py-0.5 text-2xs text-fg-muted hover:border-accent/60 hover:text-accent"
                              >
                                {String(index + 1).padStart(2, "0")}
                              </button>
                            ))}
                            {check.missing.length > 24 && (
                              <span className="px-1 text-2xs text-fg-dim">
                                {t("production:andMore", {
                                  check: check.missing.length - 24,
                                })}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>

            <AssemblyTimeline />
            <RenderAdvanced />
            <section aria-labelledby="manifest-heading">
              <h2 id="manifest-heading" className="eyebrow mb-3">
                {t("production:episodeManifest")}
              </h2>
              <div className="flex items-center gap-4 card-surface rounded-xl border p-4">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-line bg-raised text-accent">
                  <FileJson className="size-5" strokeWidth={1.5} aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-ui font-semibold text-fg">
                    {t("production:sceneListAsJson")}
                  </h3>
                  <p className="mt-0.5 text-xs leading-5 text-fg-muted">
                    {t("production:everySceneInOrderWithIts")}
                  </p>
                </div>
                <Button
                  variant="primary"
                  icon={FileJson}
                  busy={exporting}
                  onClick={async () => {
                    setExporting(true);
                    await exportManifest();
                    setExporting(false);
                  }}
                >
                  {t("production:exportManifest")}
                </Button>
              </div>
            </section>
          </div>
        </details>
      </div>
    </div>
  );
}
