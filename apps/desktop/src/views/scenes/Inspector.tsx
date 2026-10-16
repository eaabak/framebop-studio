import {
  type Asset,
  CAMERA_MOTIONS,
  type CameraMotion,
  OVERLAY_POSITIONS,
  type OverlayPosition,
  SCENE_DURATION_MAX,
  SCENE_DURATION_MIN,
  type Scene,
  type SceneSlot,
  countWords,
  estimateNarrationSeconds,
  sceneSecondsForNarration,
  formatDuration,
  isActiveJob,
} from "@framebop/core";
import {
  ArrowLeft,
  ArrowRight,
  Copy,
  MousePointerClick,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { AssetThumb } from "../../components/media";
import {
  Button,
  EmptyState,
  Field,
  IconButton,
  ProgressBar,
} from "../../components/ui";
import { bridge } from "../../lib/bridge";
import { useSelectedScene, useStudio } from "../../store/studio";
import { GenerateSection } from "./GenerateSection";
import { QuickCreate } from "./QuickCreate";
import { Section } from "./Section";
import { formatBytes, t } from "../../i18n";

const CAMERA_LABELS: Record<CameraMotion, string> = {
  get static() {
    return t("editor:static");
  },
  get push_in() {
    return t("editor:pushIn");
  },
  get pull_out() {
    return t("editor:pullOut");
  },
  get pan_left() {
    return t("editor:panLeft");
  },
  get pan_right() {
    return t("editor:panRight");
  },
  get tilt_up() {
    return t("editor:tiltUp");
  },
  get tilt_down() {
    return t("editor:tiltDown");
  },
  get orbit() {
    return t("editor:orbit");
  },
  get handheld() {
    return t("editor:handheld");
  },
};

const POSITION_LABELS: Record<OverlayPosition, string> = {
  get top() {
    return t("editor:top");
  },
  get center() {
    return t("editor:centre");
  },
  get bottom() {
    return t("editor:bottom");
  },
};

const SLOT_LABELS: Record<SceneSlot, string> = {
  get image() {
    return t("editor:stillImage");
  },
  get video() {
    return t("editor:videoClip");
  },
  get audio() {
    return t("editor:narrationAudio");
  },
};

function roundToHalf(seconds: number): number {
  return Math.round(seconds * 2) / 2;
}

function clampDuration(seconds: number): number {
  return Math.min(SCENE_DURATION_MAX, Math.max(SCENE_DURATION_MIN, seconds));
}

/** Duration is committed on blur or Enter, so half-typed values are never saved. */
function DurationInput({ scene }: { scene: Scene }) {
  const editScene = useStudio((state) => state.editScene);
  const [draft, setDraft] = useState(String(scene.durationSeconds));
  useEffect(
    () => setDraft(String(scene.durationSeconds)),
    [scene.id, scene.durationSeconds],
  );

  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed) || draft.trim() === "") {
      setDraft(String(scene.durationSeconds));
      return;
    }
    const next = clampDuration(Math.round(parsed * 100) / 100);
    setDraft(String(next));
    if (next !== scene.durationSeconds)
      editScene(scene.id, { durationSeconds: next });
  };

  return (
    <Field label={t("editor:durationSeconds")}>
      {(id) => (
        <input
          id={id}
          className="control tabular-nums"
          type="number"
          min={SCENE_DURATION_MIN}
          max={SCENE_DURATION_MAX}
          step={0.5}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      )}
    </Field>
  );
}

function describeAsset(asset: Asset): string {
  return [
    asset.width && asset.height ? `${asset.width}×${asset.height}` : null,
    asset.durationSeconds ? formatDuration(asset.durationSeconds) : null,
    formatBytes(asset.sizeBytes),
  ]
    .filter(Boolean)
    .join(" · ");
}

function MediaSlot({ scene, slot }: { scene: Scene; slot: SceneSlot }) {
  const assetId = {
    image: scene.imageAssetId,
    video: scene.videoAssetId,
    audio: scene.audioAssetId,
  }[slot];
  const asset = useStudio((state) =>
    assetId ? (state.assets[assetId] ?? null) : null,
  );
  const job = useStudio((state) =>
    state.jobs.find(
      (candidate) =>
        candidate.type === "media_import" &&
        candidate.sceneId === scene.id &&
        candidate.slot === slot &&
        isActiveJob(candidate),
    ),
  );
  const importMedia = useStudio((state) => state.importMedia);
  const clearSlot = useStudio((state) => state.clearSlot);
  const cancelJob = useStudio((state) => state.cancelJob);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-fg-muted">
          {SLOT_LABELS[slot]}
        </span>
        {!job && (
          <div className="flex items-center gap-0.5">
            <Button
              size="sm"
              variant="ghost"
              icon={Upload}
              onClick={() => void importMedia(scene.id, slot)}
            >
              {asset ? t("editor:replace") : t("editor:import")}
            </Button>
            {asset && (
              <IconButton
                label={t(
                  slot === "image"
                    ? "editor:removeImage"
                    : slot === "video"
                      ? "editor:removeVideo"
                      : "editor:removeAudio",
                )}
                icon={X}
                size="sm"
                onClick={() => void clearSlot(scene.id, slot)}
              />
            )}
          </div>
        )}
      </div>

      {job ? (
        <div className="flex items-center gap-2 rounded-md border border-line bg-canvas px-2.5 py-2">
          <div className="min-w-0 flex-1">
            <div className="mb-1.5 flex justify-between text-2xs text-fg-muted">
              <span className="truncate">{job.label}</span>
              <span className="tabular-nums">
                {job.status === "pending"
                  ? t("editor:waiting")
                  : job.progress === null
                    ? t("editor:analysing")
                    : `${Math.round(job.progress * 100)}%`}
              </span>
            </div>
            <ProgressBar value={job.status === "pending" ? 0 : job.progress} />
          </div>
          <IconButton
            label={t("editor:cancelImport")}
            icon={X}
            size="sm"
            onClick={() => void cancelJob(job.id)}
          />
        </div>
      ) : asset ? (
        <div className="flex flex-col gap-2 rounded-md border border-line bg-canvas p-1.5">
          <div className="flex items-center gap-2.5">
            <AssetThumb asset={asset} className="h-9 w-16 shrink-0 rounded" />
            <div className="min-w-0">
              <div
                data-selectable
                className="truncate text-xs text-fg"
                title={asset.originalFilename}
              >
                {asset.originalFilename}
              </div>
              <div className="timecode truncate text-2xs text-fg-dim">
                {describeAsset(asset)}
              </div>
            </div>
          </div>
          {asset.kind === "audio" && (
            <audio
              controls
              preload="metadata"
              src={bridge.mediaUrl(asset, "file")}
              className="h-8 w-full"
            />
          )}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-line-strong px-2.5 py-2 text-2xs text-fg-dim">
          {t("editor:none")}
        </div>
      )}
    </div>
  );
}

export function Inspector() {
  const scene = useSelectedScene();
  const index = useStudio((state) =>
    state.scenes.findIndex(
      (candidate) => candidate.id === state.selectedSceneId,
    ),
  );
  const sceneCount = useStudio((state) => state.scenes.length);
  const wordsPerMinute = useStudio(
    (state) => state.settings.narrationWordsPerMinute,
  );
  const clip = useStudio((state) =>
    scene?.videoAssetId ? (state.assets[scene.videoAssetId] ?? null) : null,
  );
  const narrationAudio = useStudio((state) =>
    scene?.audioAssetId ? (state.assets[scene.audioAssetId] ?? null) : null,
  );
  const editScene = useStudio((state) => state.editScene);
  const duplicateScene = useStudio((state) => state.duplicateScene);
  const deleteScene = useStudio((state) => state.deleteScene);
  const moveScene = useStudio((state) => state.moveScene);

  if (!scene) {
    return (
      <aside className="glass w-[22rem] shrink-0 overflow-hidden rounded-2xl border">
        <EmptyState
          compact
          icon={MousePointerClick}
          title={t("editor:noSceneSelected")}
          description={t("editor:selectASceneInTheStoryboard")}
        />
      </aside>
    );
  }

  const words = countWords(scene.narrationText);
  const narrationSeconds = roundToHalf(
    estimateNarrationSeconds(scene.narrationText, wordsPerMinute),
  );
  const clipSeconds = clip?.durationSeconds
    ? Math.round(clip.durationSeconds * 100) / 100
    : null;
  // Measured from the file; the render never cuts narration short.
  const spokenSeconds = narrationAudio?.durationSeconds ?? null;
  const neededSeconds =
    spokenSeconds !== null
      ? clampDuration(
          Math.ceil(sceneSecondsForNarration(spokenSeconds) * 10) / 10,
        )
      : null;

  return (
    <aside
      aria-label={t("editor:sceneInspector")}
      className="glass flex w-[22rem] shrink-0 flex-col overflow-hidden rounded-2xl border"
    >
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-line pr-2 pl-3.5">
        <h2 className="text-ui font-semibold text-fg">
          {t("editor:scene2", { value: index + 1 })}
          <span className="font-normal text-fg-dim">
            {" "}
            {t("editor:of", { sceneCount })}
          </span>
        </h2>
        <div className="flex items-center gap-0.5">
          <IconButton
            label={t("editor:moveEarlier")}
            icon={ArrowLeft}
            size="sm"
            disabled={index === 0}
            onClick={() => void moveScene(scene.id, -1)}
          />
          <IconButton
            label={t("editor:moveLater")}
            icon={ArrowRight}
            size="sm"
            disabled={index === sceneCount - 1}
            onClick={() => void moveScene(scene.id, 1)}
          />
          <IconButton
            label={t("editor:duplicateScene")}
            icon={Copy}
            size="sm"
            onClick={() => void duplicateScene(scene.id)}
          />
          <IconButton
            tone="danger"
            label={t("editor:deleteScene")}
            icon={Trash2}
            size="sm"
            onClick={() => void deleteScene(scene.id)}
          />
        </div>
      </header>

      {/* Keyed by scene so that number drafts reset when the selection changes. */}
      <div key={scene.id} className="min-h-0 flex-1 overflow-y-auto">
        <QuickCreate scene={scene} />

        <Section title={t("editor:scene3")}>
          <Field label={t("editor:title")}>
            {(id) => (
              <input
                id={id}
                className="control"
                value={scene.title}
                maxLength={160}
                placeholder={t("editor:scene2", { value: index + 1 })}
                onChange={(event) =>
                  editScene(scene.id, { title: event.target.value })
                }
              />
            )}
          </Field>
          <Field label={t("editor:description")}>
            {(id) => (
              <textarea
                id={id}
                className="control"
                rows={2}
                value={scene.description}
                maxLength={2000}
                placeholder={t("editor:whatHappensInThisScene")}
                onChange={(event) =>
                  editScene(scene.id, { description: event.target.value })
                }
              />
            )}
          </Field>
          <DurationInput scene={scene} />
          <Field
            label={t("editor:transitionIn")}
            hint={
              index === 0
                ? t("editor:theFirstSceneStartsTheVideo")
                : scene.transition === "fade"
                  ? t("editor:crossFadesFromThePreviousScene")
                  : undefined
            }
          >
            {(id) => (
              <select
                id={id}
                className="control"
                value={scene.transition}
                onChange={(event) =>
                  editScene(scene.id, {
                    transition: event.target.value as Scene["transition"],
                  })
                }
              >
                <option value="cut">{t("editor:cut")}</option>
                <option value="fade">
                  {t("editor:fadeFromThePreviousScene")}
                </option>
              </select>
            )}
          </Field>
          {clipSeconds !== null && clipSeconds !== scene.durationSeconds && (
            <button
              type="button"
              onClick={() =>
                editScene(scene.id, {
                  durationSeconds: clampDuration(clipSeconds),
                })
              }
              className="self-start text-2xs text-accent hover:underline"
            >
              {t("editor:matchTheClipSLength", {
                clipSeconds: formatDuration(clipSeconds),
              })}
            </button>
          )}
        </Section>

        <Section title={t("editor:media")}>
          <MediaSlot scene={scene} slot="image" />
          <MediaSlot scene={scene} slot="video" />
          <MediaSlot scene={scene} slot="audio" />
        </Section>

        <Section title={t("editor:textOverlay")}>
          <Field
            label={t("editor:text")}
            hint={t("editor:shownOverThePictureForThe")}
          >
            {(id) => (
              <input
                id={id}
                className="control"
                value={scene.overlayText}
                maxLength={300}
                placeholder={t("editor:none")}
                onChange={(event) =>
                  editScene(scene.id, { overlayText: event.target.value })
                }
              />
            )}
          </Field>
          <Field label={t("editor:position")}>
            {(id) => (
              <select
                id={id}
                className="control"
                value={scene.overlayPosition}
                disabled={scene.overlayText.trim() === ""}
                onChange={(event) =>
                  editScene(scene.id, {
                    overlayPosition: event.target.value as OverlayPosition,
                  })
                }
              >
                {OVERLAY_POSITIONS.map((position) => (
                  <option key={position} value={position}>
                    {POSITION_LABELS[position]}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </Section>

        <Section title={t("editor:narration")}>
          <Field
            label={t("editor:text")}
            aside={
              words > 0
                ? `${words} words · about ${formatDuration(narrationSeconds)}`
                : undefined
            }
          >
            {(id) => (
              <textarea
                id={id}
                className="control"
                rows={4}
                value={scene.narrationText}
                maxLength={10_000}
                placeholder={t("editor:whatTheNarratorSaysDuringThis")}
                onChange={(event) =>
                  editScene(scene.id, { narrationText: event.target.value })
                }
              />
            )}
          </Field>
          {spokenSeconds !== null ? (
            <div className="flex flex-col gap-1 rounded-md border border-line bg-canvas px-2.5 py-2 text-2xs leading-4">
              <span className="text-fg-muted">
                {t("editor:narrationAudioMeasuredFromTheFile", {
                  spokenSeconds: formatDuration(spokenSeconds),
                })}
              </span>
              {neededSeconds !== null &&
              neededSeconds > scene.durationSeconds ? (
                <>
                  <span className="text-warn">
                    {t("editor:longerThanTheSceneTheExport", {
                      neededSeconds: formatDuration(neededSeconds),
                    })}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      editScene(scene.id, { durationSeconds: neededSeconds })
                    }
                    className="self-start text-accent hover:underline"
                  >
                    {t("editor:fitTheSceneToTheNarration", {
                      neededSeconds: formatDuration(neededSeconds),
                    })}
                  </button>
                </>
              ) : (
                <span className="text-fg-dim">
                  {t("editor:fitsTheSceneTheRestOf")}
                </span>
              )}
            </div>
          ) : (
            words > 0 &&
            narrationSeconds !== scene.durationSeconds && (
              <button
                type="button"
                onClick={() =>
                  editScene(scene.id, {
                    durationSeconds: clampDuration(narrationSeconds),
                  })
                }
                className="self-start text-2xs text-accent hover:underline"
              >
                {t("editor:setDurationFromAnEstimateOf", {
                  clampDuration: formatDuration(
                    clampDuration(narrationSeconds),
                  ),
                })}
              </button>
            )
          )}
        </Section>

        <Section title={t("editor:prompts")}>
          <Field
            label={t("editor:imagePrompt")}
            hint={t("editor:describesTheStillFrame")}
          >
            {(id) => (
              <textarea
                id={id}
                className="control"
                rows={3}
                value={scene.imagePrompt}
                maxLength={4000}
                onChange={(event) =>
                  editScene(scene.id, { imagePrompt: event.target.value })
                }
              />
            )}
          </Field>
          <Field
            label={t("editor:motionPrompt")}
            hint={t("editor:describesHowTheFrameShouldMove")}
          >
            {(id) => (
              <textarea
                id={id}
                className="control"
                rows={3}
                value={scene.motionPrompt}
                maxLength={4000}
                onChange={(event) =>
                  editScene(scene.id, { motionPrompt: event.target.value })
                }
              />
            )}
          </Field>
        </Section>

        <Section title={t("editor:camera")}>
          <Field label={t("editor:cameraMotion")}>
            {(id) => (
              <select
                id={id}
                className="control"
                value={scene.cameraMotion}
                onChange={(event) =>
                  editScene(scene.id, {
                    cameraMotion: event.target.value as CameraMotion,
                  })
                }
              >
                {CAMERA_MOTIONS.map((motion) => (
                  <option key={motion} value={motion}>
                    {CAMERA_LABELS[motion]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={t("editor:cameraNotes")}>
            {(id) => (
              <textarea
                id={id}
                className="control"
                rows={2}
                value={scene.cameraInstructions}
                maxLength={2000}
                placeholder={t("editor:slowPushTowardsTheTempleSteps")}
                onChange={(event) =>
                  editScene(scene.id, {
                    cameraInstructions: event.target.value,
                  })
                }
              />
            )}
          </Field>
        </Section>

        <GenerateSection scene={scene} />
      </div>
    </aside>
  );
}
