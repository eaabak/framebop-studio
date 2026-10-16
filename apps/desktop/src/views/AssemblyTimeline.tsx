/**
 * The assembled timeline of an episode, before it is built: each scene's
 * picture as the render will draw it (stills, clips, animation, chosen holds)
 * against how long the scene lasts, with every gap shown in seconds. The
 * shots of a scene are edited here; nothing is stretched to fill time.
 */
import {
  type Asset,
  type BlueprintScene,
  type CoverageKind,
  NARRATION_LEAD_SECONDS,
  NARRATION_TAIL_SECONDS,
  type Scene,
  type SceneCoverage,
  type SceneShot,
  effectiveShots,
} from "@framebop/core";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Film,
  ImagePlus,
  Pause,
  Ruler,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AssetThumb } from "../components/media";
import { Button, cx } from "../components/ui";
import { t } from "../i18n";
import { useBlueprint } from "../store/blueprint";
import { useStudio } from "../store/studio";

const SEGMENT_TONE: Record<CoverageKind | "gap", string> = {
  clip: "bg-accent",
  still: "bg-sky-400/80",
  animation: "bg-violet-400/80",
  hold: "bg-warn/70 [background-image:repeating-linear-gradient(45deg,transparent_0_4px,rgb(0_0_0/0.25)_4px_8px)]",
  pose: "bg-violet-400/40",
  gap: "bg-danger/25 [background-image:repeating-linear-gradient(45deg,transparent_0_4px,rgb(220_38_38/0.5)_4px_8px)]",
};

const kindLabel = (kind: CoverageKind | "gap") =>
  ({
    clip: t("assembly:kindClip"),
    still: t("assembly:kindStill"),
    animation: t("assembly:kindAnimation"),
    hold: t("assembly:kindHold"),
    pose: t("assembly:kindPose"),
    gap: t("assembly:kindGap"),
  })[kind];

const seconds = (value: number) =>
  t("assembly:seconds", { value: value.toFixed(1) });

/** One bar: the scene's length, split into what fills it. */
function CoverageBar({ coverage }: { coverage: SceneCoverage }) {
  const total = Math.max(
    coverage.requiredSeconds,
    coverage.coveredSeconds + coverage.gapSeconds,
    0.001,
  );
  const parts: { kind: CoverageKind | "gap"; seconds: number }[] = [
    ...coverage.segments,
    ...(coverage.gapSeconds > 0
      ? [{ kind: "gap" as const, seconds: coverage.gapSeconds }]
      : []),
  ];
  return (
    <div
      className="flex h-3 w-full overflow-hidden rounded-sm bg-line-strong"
      role="img"
      aria-label={parts
        .map((part) => `${kindLabel(part.kind)} ${seconds(part.seconds)}`)
        .join(", ")}
    >
      {coverage.textOnly ? (
        <div
          className="h-full w-full bg-fg-dim/30"
          title={t("assembly:textOnly")}
        />
      ) : (
        parts.map((part, index) => (
          <div
            // Segments keep their order; the index is their identity.
            // eslint-disable-next-line react/no-array-index-key
            key={index}
            title={`${kindLabel(part.kind)} · ${seconds(part.seconds)}`}
            className={cx(
              "h-full border-r border-canvas/60 last:border-r-0",
              SEGMENT_TONE[part.kind],
            )}
            style={{
              width: `${(Math.min(part.seconds, total) / total) * 100}%`,
            }}
          />
        ))
      )}
    </div>
  );
}

function NumberBox({
  label,
  value,
  placeholder,
  onCommit,
}: {
  label: string;
  value: number | null;
  placeholder?: string;
  onCommit(value: number | null): void;
}) {
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  useEffect(() => setDraft(value === null ? "" : String(value)), [value]);
  return (
    <label className="flex flex-col gap-0.5 text-2xs text-fg-dim">
      {label}
      <input
        className="control h-7 w-20 text-xs tabular-nums"
        inputMode="decimal"
        placeholder={placeholder}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const trimmed = draft.trim().replace(",", ".");
          const next = trimmed === "" ? null : Number(trimmed);
          if (next !== null && (!Number.isFinite(next) || next < 0)) {
            setDraft(value === null ? "" : String(value));
            return;
          }
          if (next !== value) onCommit(next);
        }}
      />
    </label>
  );
}

function ShotRow({
  shot,
  index,
  count,
  asset,
  onChange,
  onMove,
  onRemove,
}: {
  shot: SceneShot;
  index: number;
  count: number;
  asset: Asset | null;
  onChange(shot: SceneShot): void;
  onMove(offset: number): void;
  onRemove(): void;
}) {
  return (
    <li className="flex flex-wrap items-end gap-2 rounded-md border border-line bg-canvas p-2">
      <AssetThumb asset={asset} className="h-10 w-[70px] shrink-0 rounded" />
      <div className="flex min-w-[90px] flex-col text-2xs">
        <span className="font-medium text-fg">
          {index + 1}.{" "}
          {shot.kind === "clip"
            ? t("assembly:kindClip")
            : t("assembly:kindStill")}
        </span>
        <span className="text-fg-dim">
          {shot.kind === "clip" && asset?.durationSeconds
            ? t("assembly:sourceLength", {
                value: asset.durationSeconds.toFixed(1),
              })
            : asset?.originalFilename}
        </span>
      </div>
      {shot.kind === "clip" ? (
        <>
          <NumberBox
            label={t("assembly:trimStart")}
            value={shot.trimStart}
            onCommit={(value) => onChange({ ...shot, trimStart: value ?? 0 })}
          />
          <NumberBox
            label={t("assembly:trimEnd")}
            value={shot.trimEnd}
            placeholder={t("assembly:toTheEnd")}
            onCommit={(value) => onChange({ ...shot, trimEnd: value })}
          />
          <NumberBox
            label={t("assembly:holdLastFrame")}
            value={shot.holdSeconds}
            onCommit={(value) => onChange({ ...shot, holdSeconds: value ?? 0 })}
          />
        </>
      ) : (
        <NumberBox
          label={t("assembly:showFor")}
          value={shot.seconds}
          placeholder={t("assembly:restOfScene")}
          onCommit={(value) =>
            onChange({ ...shot, seconds: value === 0 ? null : value })
          }
        />
      )}
      <div className="ml-auto flex gap-0.5">
        <button
          type="button"
          className="rounded p-1 text-fg-dim hover:text-fg disabled:opacity-30"
          aria-label={t("assembly:moveEarlier")}
          disabled={index === 0}
          onClick={() => onMove(-1)}
        >
          <ArrowUp className="size-3.5" aria-hidden />
        </button>
        <button
          type="button"
          className="rounded p-1 text-fg-dim hover:text-fg disabled:opacity-30"
          aria-label={t("assembly:moveLater")}
          disabled={index === count - 1}
          onClick={() => onMove(1)}
        >
          <ArrowDown className="size-3.5" aria-hidden />
        </button>
        <button
          type="button"
          className="rounded p-1 text-fg-dim hover:text-danger"
          aria-label={t("assembly:removeShot")}
          onClick={onRemove}
        >
          <Trash2 className="size-3.5" aria-hidden />
        </button>
      </div>
    </li>
  );
}

/** Pictures and clips of this episode that a shot can show. */
function useEpisodeMedia(): Asset[] {
  const assets = useStudio((state) => state.assets);
  const scenes = useStudio((state) => state.scenes);
  const jobs = useStudio((state) => state.jobs);
  const episodeId = useStudio((state) => state.activeEpisodeId);
  return useMemo(() => {
    const ids = new Set<string>();
    for (const scene of scenes) {
      if (scene.imageAssetId) ids.add(scene.imageAssetId);
      if (scene.videoAssetId) ids.add(scene.videoAssetId);
    }
    for (const job of jobs) {
      if (
        job.episodeId === episodeId &&
        job.status === "completed" &&
        job.outputAssetId
      ) {
        ids.add(job.outputAssetId);
      }
    }
    return [...ids]
      .map((id) => assets[id])
      .filter((asset): asset is Asset => !!asset && asset.kind !== "audio");
  }, [assets, scenes, jobs, episodeId]);
}

function SceneEditor({
  scene,
  planned,
  coverage,
}: {
  scene: Scene;
  planned: BlueprintScene;
  coverage: SceneCoverage;
}) {
  const updatePlan = useBlueprint((state) => state.updatePlan);
  const refreshRenders = useStudio((state) => state.refreshRenders);
  const editScene = useStudio((state) => state.editScene);
  const assets = useStudio((state) => state.assets);
  const media = useEpisodeMedia();
  const [adding, setAdding] = useState(false);
  const [caption, setCaption] = useState(planned.plan.captionText ?? "");
  useEffect(
    () => setCaption(planned.plan.captionText ?? ""),
    [planned.plan.captionText],
  );

  const animated =
    planned.plan.method === "layered-2d" && planned.plan.animation !== null;
  const shots = effectiveShots(scene, planned.plan.shots);
  const save = async (next: SceneShot[]) => {
    await updatePlan(scene.id, { shots: next });
    await refreshRenders();
  };
  const last = shots[shots.length - 1];
  const gap = coverage.gapSeconds;
  // The shortest the scene can be without cutting its narration.
  const narrationNeeds =
    coverage.narrationSeconds !== null
      ? NARRATION_LEAD_SECONDS +
        coverage.narrationSeconds +
        NARRATION_TAIL_SECONDS
      : 0;
  const canShorten =
    gap > 0 &&
    coverage.coveredSeconds > 0 &&
    coverage.coveredSeconds >= narrationNeeds - 0.01;

  return (
    <div className="flex flex-col gap-2.5 border-t border-line pt-2.5">
      {animated ? (
        <p className="text-2xs leading-4 text-fg-muted">
          {t("assembly:animationNote")}
        </p>
      ) : (
        <>
          {shots.length === 0 ? (
            <p className="text-2xs text-fg-dim">{t("assembly:noShots")}</p>
          ) : (
            <ol className="flex flex-col gap-1.5">
              {shots.map((shot, index) => (
                <ShotRow
                  // Shots are edited in place; their position is their identity.
                  // eslint-disable-next-line react/no-array-index-key
                  key={`${index}:${shot.assetId}`}
                  shot={shot}
                  index={index}
                  count={shots.length}
                  asset={assets[shot.assetId] ?? null}
                  onChange={(next) =>
                    void save(
                      shots.map((item, i) => (i === index ? next : item)),
                    )
                  }
                  onMove={(offset) => {
                    const next = [...shots];
                    const [moved] = next.splice(index, 1);
                    if (moved) next.splice(index + offset, 0, moved);
                    void save(next);
                  }}
                  onRemove={() =>
                    void save(shots.filter((_, i) => i !== index))
                  }
                />
              ))}
            </ol>
          )}
          {gap > 0 && (
            <div className="flex flex-col gap-1.5 rounded-md border border-danger/30 bg-danger/10 p-2 text-2xs leading-4 text-fg">
              <p>
                {t("assembly:gapExplained", {
                  gap: gap.toFixed(1),
                  scene: coverage.requiredSeconds.toFixed(1),
                })}
              </p>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  size="sm"
                  icon={ImagePlus}
                  onClick={() => setAdding(true)}
                >
                  {t("assembly:addShot")}
                </Button>
                {last?.kind === "clip" && (
                  <Button
                    size="sm"
                    icon={Pause}
                    onClick={() =>
                      void save(
                        shots.map((shot, i) =>
                          i === shots.length - 1 && shot.kind === "clip"
                            ? {
                                ...shot,
                                holdSeconds:
                                  Math.round((shot.holdSeconds + gap) * 100) /
                                  100,
                              }
                            : shot,
                        ),
                      )
                    }
                  >
                    {t("assembly:holdForGap", { gap: gap.toFixed(1) })}
                  </Button>
                )}
                {canShorten && (
                  <Button
                    size="sm"
                    icon={Ruler}
                    onClick={() =>
                      editScene(scene.id, {
                        durationSeconds:
                          Math.round(coverage.coveredSeconds * 100) / 100,
                      })
                    }
                  >
                    {t("assembly:shortenTo", {
                      value: coverage.coveredSeconds.toFixed(1),
                    })}
                  </Button>
                )}
              </div>
            </div>
          )}
          {adding || (gap === 0 && shots.length < 20) ? (
            adding ? (
              <div className="flex flex-col gap-1.5">
                <p className="text-2xs text-fg-dim">
                  {t("assembly:chooseMedia")}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {media.map((asset) => (
                    <button
                      key={asset.id}
                      type="button"
                      title={asset.originalFilename}
                      onClick={() => {
                        setAdding(false);
                        void save([
                          ...shots,
                          asset.kind === "video"
                            ? {
                                kind: "clip",
                                assetId: asset.id,
                                trimStart: 0,
                                trimEnd: null,
                                holdSeconds: 0,
                              }
                            : {
                                kind: "still",
                                assetId: asset.id,
                                seconds:
                                  gap > 0 ? Math.round(gap * 100) / 100 : null,
                              },
                        ]);
                      }}
                      className="relative overflow-hidden rounded border border-line hover:border-accent"
                    >
                      <AssetThumb asset={asset} className="h-10 w-[70px]" />
                      <span className="absolute right-0.5 bottom-0.5 rounded bg-black/60 px-1 text-[10px] text-white">
                        {asset.kind === "video"
                          ? t("assembly:kindClip")
                          : t("assembly:kindStill")}
                      </span>
                    </button>
                  ))}
                  {media.length === 0 && (
                    <span className="text-2xs text-fg-dim">
                      {t("assembly:noMedia")}
                    </span>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="self-start"
                  onClick={() => setAdding(false)}
                >
                  {t("assembly:cancel")}
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                icon={Film}
                className="self-start"
                onClick={() => setAdding(true)}
              >
                {t("assembly:addShot")}
              </Button>
            )
          ) : null}
        </>
      )}

      <label className="flex flex-col gap-1 text-2xs text-fg-dim">
        {t("assembly:subtitleText")}
        <textarea
          rows={2}
          className="control resize-y text-xs"
          placeholder={scene.narrationText || t("assembly:noNarrationText")}
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
          onBlur={async () => {
            const next = caption.trim() === "" ? null : caption;
            if (next === planned.plan.captionText) return;
            await updatePlan(scene.id, { captionText: next });
            await refreshRenders();
          }}
        />
        <span className="leading-4">{t("assembly:subtitleHint")}</span>
      </label>
    </div>
  );
}

function SceneRow({
  index,
  scene,
  planned,
  coverage,
}: {
  index: number;
  scene: Scene;
  planned: BlueprintScene | undefined;
  coverage: SceneCoverage;
}) {
  const [open, setOpen] = useState(coverage.gapSeconds > 0);
  const facts = [
    t("assembly:needs", { value: coverage.requiredSeconds.toFixed(1) }),
    coverage.textOnly
      ? t("assembly:textOnly")
      : t("assembly:covered", { value: coverage.coveredSeconds.toFixed(1) }),
    coverage.narrationSeconds !== null
      ? t("assembly:narration", { value: coverage.narrationSeconds.toFixed(1) })
      : t("assembly:noNarration"),
    coverage.overrunSeconds > 0
      ? t("assembly:cut", { value: coverage.overrunSeconds.toFixed(1) })
      : null,
  ].filter(Boolean);
  return (
    <li className="flex flex-col gap-2 p-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2 text-left"
      >
        <ChevronRight
          className={cx(
            "size-3.5 shrink-0 text-fg-dim transition-transform",
            open && "rotate-90",
          )}
          aria-hidden
        />
        <span className="timecode text-2xs text-fg-dim">
          {String(index + 1).padStart(2, "0")}
        </span>
        <span className="min-w-0 flex-1 truncate text-ui font-medium text-fg">
          {scene.title || t("assembly:untitled")}
        </span>
        {coverage.gapSeconds > 0 ? (
          <span className="shrink-0 text-2xs font-medium text-danger">
            {t("assembly:gap", { value: coverage.gapSeconds.toFixed(1) })}
          </span>
        ) : (
          <span className="shrink-0 text-2xs text-ok">
            {t("assembly:fullyCovered")}
          </span>
        )}
      </button>
      <CoverageBar coverage={coverage} />
      <p className="text-2xs text-fg-dim tabular-nums">{facts.join(" · ")}</p>
      {open && planned && (
        <SceneEditor scene={scene} planned={planned} coverage={coverage} />
      )}
    </li>
  );
}

export function AssemblyTimeline() {
  const episodeId = useStudio((state) => state.activeEpisodeId);
  const scenes = useStudio((state) => state.scenes);
  const preview = useStudio((state) => state.renderPreview);
  const blueprint = useBlueprint((state) => state.blueprint);
  const loadBlueprint = useBlueprint((state) => state.load);
  useEffect(() => {
    if (episodeId) void loadBlueprint(episodeId);
  }, [episodeId, loadBlueprint]);

  const coverage = preview?.coverage ?? [];
  if (coverage.length === 0) return null;
  const gaps = coverage.filter((item) => item.gapSeconds > 0).length;
  const legend: (CoverageKind | "gap")[] = [
    "clip",
    "still",
    "animation",
    "hold",
    "pose",
    "gap",
  ];

  return (
    <section aria-labelledby="timeline-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="timeline-heading" className="eyebrow">
          {t("assembly:timeline")}
        </h2>
        <span className={cx("text-xs", gaps > 0 ? "text-danger" : "text-ok")}>
          {gaps > 0
            ? t("assembly:scenesWithGaps", { count: gaps })
            : t("assembly:everySceneCovered")}
        </span>
      </div>
      <ul className="flex flex-wrap gap-3 text-2xs text-fg-muted">
        {legend.map((kind) => (
          <li key={kind} className="flex items-center gap-1.5">
            <span
              className={cx(
                "inline-block size-2.5 rounded-sm",
                SEGMENT_TONE[kind],
              )}
              aria-hidden
            />
            {kindLabel(kind)}
          </li>
        ))}
      </ul>
      <ol className="divide-y divide-line overflow-hidden card-surface rounded-xl border">
        {coverage.map((item, index) => {
          const scene = scenes.find(
            (candidate) => candidate.id === item.sceneId,
          );
          if (!scene) return null;
          return (
            <SceneRow
              key={item.sceneId}
              index={index}
              scene={scene}
              planned={blueprint?.scenes.find(
                (candidate) => candidate.sceneId === item.sceneId,
              )}
              coverage={item}
            />
          );
        })}
      </ol>
    </section>
  );
}
