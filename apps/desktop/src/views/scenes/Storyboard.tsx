import { formatDuration } from "@framebop/core";
import { AudioLines, FolderInput, Plus } from "lucide-react";
import { useEffect, useRef } from "react";
import { AssetThumb, sceneLabel, visualAssetOf } from "../../components/media";
import { Button, cx } from "../../components/ui";
import { useStudio } from "../../store/studio";
import { useReorder } from "./useReorder";
import { t } from "../../i18n";

export function Storyboard() {
  const scenes = useStudio((state) => state.scenes);
  const assets = useStudio((state) => state.assets);
  const selectedSceneId = useStudio((state) => state.selectedSceneId);
  const selectScene = useStudio((state) => state.selectScene);
  const addScene = useStudio((state) => state.addScene);
  const importAsNewScenes = useStudio((state) => state.importAsNewScenes);
  const reorderScenes = useStudio((state) => state.reorderScenes);

  const { containerRef, drag, itemProps } = useReorder(
    scenes.map((scene) => scene.id),
    (ids) => void reorderScenes(ids),
  );

  // Keep the selected card in view when selection changes elsewhere.
  const selectedCard = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    selectedCard.current?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [selectedSceneId]);

  return (
    <section
      aria-label={t("editor:storyboard")}
      className="shrink-0 border-t border-line bg-surface"
    >
      <div className="flex h-8 items-center justify-between px-3">
        <h2 className="eyebrow">{t("editor:storyboard")}</h2>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            icon={FolderInput}
            onClick={() => void importAsNewScenes()}
          >
            {t("editor:importMediaAsScenes")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={Plus}
            onClick={() => void addScene(selectedSceneId ?? undefined)}
          >
            {t("editor:addScene")}
          </Button>
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative flex gap-2 overflow-x-auto px-3 pt-0.5 pb-3"
      >
        {scenes.map((scene, index) => {
          const selected = scene.id === selectedSceneId;
          return (
            <button
              key={scene.id}
              ref={selected ? selectedCard : undefined}
              type="button"
              aria-pressed={selected}
              onClick={() => selectScene(scene.id)}
              className={cx(
                "group flex w-32 shrink-0 touch-none flex-col gap-1 text-left transition-opacity",
                drag?.id === scene.id && "opacity-40",
              )}
              {...itemProps(scene.id)}
            >
              <div
                className={cx(
                  "relative w-full overflow-hidden rounded-lg transition-shadow",
                  selected
                    ? "shadow-[0_0_0_2px_var(--color-accent)]"
                    : "shadow-[0_0_0_1px_var(--color-line)] group-hover:shadow-[0_0_0_1px_var(--color-line-strong)]",
                )}
              >
                <AssetThumb
                  asset={visualAssetOf(scene, assets)}
                  className="aspect-video w-full"
                />
                <span className="timecode absolute top-1 left-1 rounded bg-black/65 px-1 text-2xs font-semibold text-fg">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="timecode absolute right-1 bottom-1 flex items-center gap-1 rounded bg-black/65 px-1 text-2xs text-fg-muted">
                  {scene.audioAssetId && (
                    <AudioLines
                      className="size-2.5 text-accent"
                      aria-label={t("editor:hasAudio")}
                    />
                  )}
                  {formatDuration(scene.durationSeconds)}
                </span>
              </div>
              <span
                className={cx(
                  "truncate text-2xs",
                  selected ? "text-fg" : "text-fg-muted",
                )}
              >
                {sceneLabel(scene, index)}
              </span>
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => void addScene()}
          aria-label={t("editor:addSceneAtTheEnd")}
          className="flex aspect-video w-32 shrink-0 items-center justify-center self-start rounded-lg border border-dashed border-line-strong text-fg-dim transition-colors hover:border-accent/60 hover:text-accent"
        >
          <Plus className="size-4" aria-hidden />
        </button>

        {drag && (
          <div
            className="pointer-events-none absolute top-0.5 bottom-3 w-0.5 -translate-x-[5px] rounded-full bg-accent shadow-[0_0_8px_var(--color-accent)]"
            style={{ left: drag.markerX }}
          />
        )}
      </div>
    </section>
  );
}
