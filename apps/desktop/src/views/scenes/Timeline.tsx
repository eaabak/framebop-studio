import { formatClock, formatDuration } from "@framebop/core";
import { AudioLines, Film, Maximize2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AssetThumb, sceneLabel, visualAssetOf } from "../../components/media";
import { IconButton, cx } from "../../components/ui";
import { usePlayback } from "../../store/playback";
import { useStudio } from "../../store/studio";
import { useReorder } from "./useReorder";
import { t } from "../../i18n";

const MIN_ZOOM = 4;
const MAX_ZOOM = 160;
const LABEL_COLUMN_PX = 36;
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

/** The vertical line marking the current playback position. */
function Playhead({
  sceneStart,
  sceneDuration,
  zoom,
}: {
  sceneStart: number;
  sceneDuration: number;
  zoom: number;
}) {
  const time = usePlayback((state) => state.time);
  const x = (sceneStart + Math.min(time, sceneDuration)) * zoom;
  return (
    <div
      className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-accent"
      style={{ transform: `translateX(${x}px)` }}
    >
      <div className="absolute -top-px -left-[4px] size-[9px] rounded-b-sm bg-accent" />
    </div>
  );
}

export function Timeline() {
  const scenes = useStudio((state) => state.scenes);
  const assets = useStudio((state) => state.assets);
  const episodeId = useStudio((state) => state.activeEpisodeId);
  const selectedSceneId = useStudio((state) => state.selectedSceneId);
  const selectScene = useStudio((state) => state.selectScene);
  const reorderScenes = useStudio((state) => state.reorderScenes);
  const targetSeconds = useStudio(
    (state) =>
      state.projects.find((project) => project.id === state.activeProjectId)
        ?.targetDurationSeconds ?? 0,
  );

  const [zoom, setZoom] = useState(40);
  const scroller = useRef<HTMLDivElement>(null);
  const { containerRef, drag, itemProps } = useReorder(
    scenes.map((scene) => scene.id),
    (ids) => void reorderScenes(ids),
  );

  // Start time of each scene: the running total of the durations before it.
  const starts = useMemo(() => {
    let elapsed = 0;
    return scenes.map((scene) => {
      const start = elapsed;
      elapsed += scene.durationSeconds;
      return start;
    });
  }, [scenes]);
  const total = scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
  const selectedIndex = scenes.findIndex(
    (scene) => scene.id === selectedSceneId,
  );

  const fit = useCallback(() => {
    const width = (scroller.current?.clientWidth ?? 0) - LABEL_COLUMN_PX - 24;
    if (total > 0 && width > 0) {
      setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, width / total)));
    }
  }, [total]);

  // Show a newly opened episode in full. Later edits keep the chosen zoom.
  const fittedEpisode = useRef<string | null>(null);
  useEffect(() => {
    if (episodeId && total > 0 && fittedEpisode.current !== episodeId) {
      fittedEpisode.current = episodeId;
      fit();
    }
  }, [episodeId, total, fit]);

  const tickStep = TICK_STEPS.find((step) => step * zoom >= 64) ?? 600;
  const ticks = Array.from(
    { length: Math.floor(total / tickStep) + 1 },
    (_, index) => index * tickStep,
  );
  const contentWidth = total * zoom;

  const selectAt = (clientX: number, element: HTMLElement) => {
    const seconds = (clientX - element.getBoundingClientRect().left) / zoom;
    const index = starts.findLastIndex((start) => start <= seconds);
    const scene = scenes[Math.max(0, index)];
    if (scene) selectScene(scene.id);
  };

  const overTarget = targetSeconds > 0 && total > targetSeconds;

  return (
    <section
      aria-label={t("editor:timeline")}
      className="shrink-0 border-t border-line bg-surface"
    >
      <div className="flex h-8 items-center justify-between px-3">
        <div className="flex items-baseline gap-3">
          <h2 className="eyebrow">{t("editor:timeline")}</h2>
          <span className="timecode text-2xs text-fg-muted">
            {formatDuration(total)}
            {targetSeconds > 0 && (
              <span className={overTarget ? "text-warn" : "text-fg-dim"}>
                {" "}
                {t("editor:ofTarget", {
                  targetSeconds: formatDuration(targetSeconds),
                })}
              </span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <input
            type="range"
            aria-label={t("editor:timelineZoom")}
            title={t("editor:zoom")}
            className="slider w-24"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={1}
            value={zoom}
            style={
              {
                "--fill": `${((zoom - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM)) * 100}%`,
              } as React.CSSProperties
            }
            onChange={(event) => setZoom(Number(event.target.value))}
          />
          <IconButton
            label={t("editor:fitTheWholeEpisode")}
            icon={Maximize2}
            size="sm"
            onClick={fit}
          />
        </div>
      </div>

      <div ref={scroller} className="overflow-x-auto pb-2">
        <div
          className="flex"
          style={{ width: contentWidth + LABEL_COLUMN_PX + 24 }}
        >
          <div
            className="sticky left-0 z-20 flex shrink-0 flex-col bg-surface"
            style={{ width: LABEL_COLUMN_PX }}
          >
            <div className="h-5" />
            <div
              className="flex h-12 items-center justify-center text-fg-dim"
              title={t("editor:picture")}
            >
              <Film
                className="size-3.5"
                aria-label={t("editor:pictureTrack")}
              />
            </div>
            <div
              className="mt-1 flex h-5 items-center justify-center text-fg-dim"
              title={t("editor:narrationAudio")}
            >
              <AudioLines
                className="size-3.5"
                aria-label={t("editor:audioTrack")}
              />
            </div>
          </div>

          <div className="relative" style={{ width: contentWidth }}>
            {/* Ruler: click to jump to the scene at that moment. */}
            <div
              className="relative h-5 border-b border-line"
              onClick={(event) => selectAt(event.clientX, event.currentTarget)}
            >
              {ticks.map((seconds) => (
                <div
                  key={seconds}
                  className="absolute top-0 bottom-0 border-l border-line-strong pl-1"
                  style={{ left: seconds * zoom }}
                >
                  <span className="timecode text-2xs leading-none text-fg-dim">
                    {formatClock(seconds)}
                  </span>
                </div>
              ))}
            </div>

            <div ref={containerRef} className="relative flex h-12">
              {scenes.map((scene, index) => {
                const selected = scene.id === selectedSceneId;
                const width = scene.durationSeconds * zoom;
                const asset = visualAssetOf(scene, assets);
                return (
                  <button
                    key={scene.id}
                    type="button"
                    aria-pressed={selected}
                    title={`${sceneLabel(scene, index)} · ${formatDuration(scene.durationSeconds)}`}
                    onClick={() => selectScene(scene.id)}
                    style={{ width }}
                    className={cx(
                      "relative flex h-full shrink-0 touch-none items-stretch overflow-hidden border-r border-canvas text-left transition-colors",
                      selected
                        ? "z-[1] bg-accent/20 shadow-[inset_0_0_0_1.5px_var(--color-accent)]"
                        : asset
                          ? "bg-overlay hover:bg-line-strong"
                          : "bg-raised hover:bg-overlay",
                      index === 0 && "rounded-l",
                      index === scenes.length - 1 && "rounded-r",
                      drag?.id === scene.id && "opacity-40",
                    )}
                    {...itemProps(scene.id)}
                  >
                    {width >= 72 && asset && (
                      <AssetThumb
                        asset={asset}
                        className="aspect-video h-full shrink-0"
                      />
                    )}
                    {width >= 44 && (
                      <span className="flex min-w-0 flex-col justify-center px-1.5">
                        <span
                          className={cx(
                            "truncate text-2xs font-medium",
                            selected ? "text-fg" : "text-fg-muted",
                          )}
                        >
                          {width >= 110 ? sceneLabel(scene, index) : index + 1}
                        </span>
                        {width >= 110 && (
                          <span className="timecode truncate text-2xs text-fg-dim">
                            {formatDuration(scene.durationSeconds)}
                          </span>
                        )}
                      </span>
                    )}
                  </button>
                );
              })}
              {drag && (
                <div
                  className="pointer-events-none absolute top-0 bottom-0 z-10 w-0.5 -translate-x-px bg-accent shadow-[0_0_8px_var(--color-accent)]"
                  style={{ left: drag.markerX }}
                />
              )}
            </div>

            {/* Audio track: filled where a scene has narration audio. */}
            <div className="mt-1 flex h-5">
              {scenes.map((scene) => {
                const width = scene.durationSeconds * zoom;
                return (
                  <div
                    key={scene.id}
                    style={{ width }}
                    className="h-full shrink-0 border-r border-canvas"
                  >
                    <div
                      className={cx(
                        "flex size-full items-center overflow-hidden rounded-sm px-1.5 text-2xs",
                        scene.audioAssetId
                          ? "bg-[#0c5f68]/70 text-[#8fe3e8]"
                          : "border border-dashed border-line-strong text-fg-dim",
                      )}
                    >
                      {width >= 72 &&
                        (scene.audioAssetId
                          ? t("editor:audio")
                          : t("editor:noAudio"))}
                    </div>
                  </div>
                );
              })}
            </div>

            {selectedIndex !== -1 && (
              <Playhead
                sceneStart={starts[selectedIndex] ?? 0}
                sceneDuration={scenes[selectedIndex]?.durationSeconds ?? 0}
                zoom={zoom}
              />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
