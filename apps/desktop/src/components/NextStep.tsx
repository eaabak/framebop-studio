/**
 * "What now?": one sentence and one button for the next thing an episode
 * needs, worked out from its scenes. Shown above the three main steps.
 */
import { ArrowRight, Sparkles } from "lucide-react";
import { useEffect } from "react";
import { t } from "../i18n";
import { openPanel } from "../lib/dialogs";
import { useBlueprint } from "../store/blueprint";
import { useStudio } from "../store/studio";
import { Button } from "./ui";

export function NextStep() {
  const episodeId = useStudio((state) => state.activeEpisodeId);
  const projectId = useStudio((state) => state.activeProjectId);
  const scenes = useStudio((state) => state.scenes);
  const tab = useStudio((state) => state.tab);
  const setTab = useStudio((state) => state.setTab);
  const selectScene = useStudio((state) => state.selectScene);
  const addScene = useStudio((state) => state.addScene);
  const blueprint = useBlueprint((state) => state.blueprint);
  const loadBlueprint = useBlueprint((state) => state.load);
  useEffect(() => {
    if (episodeId) void loadBlueprint(episodeId);
  }, [episodeId, loadBlueprint]);

  if (!projectId) return null;

  let text: string;
  let action: string;
  let go: () => void;
  // Scenes drawn by the 2D engine have their picture already.
  const animated = new Set(
    (blueprint?.scenes ?? [])
      .filter(
        (item) => item.plan.method === "layered-2d" && item.plan.animation,
      )
      .map((item) => item.sceneId),
  );
  const noPicture = scenes.filter(
    (scene) =>
      !scene.imageAssetId &&
      !scene.videoAssetId &&
      !scene.overlayText.trim() &&
      !animated.has(scene.id),
  );
  const noVoice = scenes.filter(
    (scene) => scene.narrationText.trim() && !scene.audioAssetId,
  );
  const open = (sceneId: string | undefined) => {
    if (sceneId) selectScene(sceneId);
    setTab("scenes");
  };

  if (!episodeId) {
    text = t("next:noEpisode");
    action = t("next:noEpisodeAction");
    go = () => openPanel("newEpisode");
  } else if (scenes.length === 0) {
    text = t("next:noScenes");
    action = t("next:noScenesAction");
    go = () => {
      void addScene();
      setTab("scenes");
    };
  } else if (noPicture.length > 0) {
    text = t("next:noPicture", { count: noPicture.length });
    action = t("next:noPictureAction");
    go = () => open(noPicture[0]?.id);
  } else if (noVoice.length > 0) {
    text = t("next:noVoice", { count: noVoice.length });
    action = t("next:noVoiceAction");
    go = () => open(noVoice[0]?.id);
  } else {
    text = t("next:ready");
    action = t("next:readyAction");
    go = () => setTab("export");
  }
  // On the Video step, "build the video" is already the page itself.
  if (tab === "export" && action === t("next:readyAction")) return null;

  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-3 border-b border-accent/20 bg-accent/[0.07] px-4 py-2.5"
    >
      <Sparkles className="size-4 shrink-0 text-accent" aria-hidden />
      <p className="min-w-0 flex-1 text-xs text-fg">
        <span className="mr-1.5 font-semibold text-accent">
          {t("next:label")}
        </span>
        {text}
      </p>
      <Button size="sm" variant="primary" icon={ArrowRight} onClick={go}>
        {action}
      </Button>
    </div>
  );
}
