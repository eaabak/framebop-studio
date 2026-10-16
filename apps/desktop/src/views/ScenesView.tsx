import { mediaFormatFor } from "@framebop/core";
import {
  Clapperboard,
  FileText,
  FolderInput,
  FolderOpen,
  Plus,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button, EmptyState, ErrorState, Spinner } from "../components/ui";
import { bridge } from "../lib/bridge";
import { openPanel } from "../lib/dialogs";
import { isTextEntry } from "../lib/platform";
import { useStudio } from "../store/studio";
import { Inspector } from "./scenes/Inspector";
import { Preview } from "./scenes/Preview";
import { Storyboard } from "./scenes/Storyboard";
import { Timeline } from "./scenes/Timeline";
import { t } from "../i18n";

/** Guidance shown instead of a workspace when there is nothing to work on. */
export function NoEpisode({ purpose }: { purpose: string }) {
  const activeProjectId = useStudio((state) => state.activeProjectId);
  const hasProjects = useStudio((state) => state.projects.length > 0);
  const setTab = useStudio((state) => state.setTab);

  if (!activeProjectId) {
    return (
      <EmptyState
        icon={FolderOpen}
        title={
          hasProjects
            ? t("editor:openAProject")
            : t("editor:createYourFirstProject")
        }
        description={
          hasProjects
            ? t("editor:chooseAProjectInTheSidebar", { purpose })
            : t("editor:aProjectHoldsYourEpisodesCreate", { purpose })
        }
        action={
          hasProjects ? (
            <Button onClick={() => setTab("projects")}>
              {t("editor:browseProjects")}
            </Button>
          ) : (
            <Button
              variant="primary"
              icon={Plus}
              onClick={() => openPanel("newProject")}
            >
              {t("editor:newProject")}
            </Button>
          )
        }
      />
    );
  }
  return (
    <EmptyState
      icon={Clapperboard}
      title={t("editor:thisProjectHasNoEpisodes")}
      description={t("editor:addAnEpisodeTo", { purpose })}
      action={
        <Button
          variant="primary"
          icon={Plus}
          onClick={() => openPanel("newEpisode")}
        >
          {t("editor:newEpisode")}
        </Button>
      }
    />
  );
}

/** Imports files dropped onto the window from the operating system. */
function useFileDrop(): boolean {
  const [overScene, setOverScene] = useState(false);

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;

    void bridge
      .onFileDrop((event) => {
        if (event.phase === "leave") {
          setOverScene(false);
          return;
        }
        // A single file over the preview goes into the selected scene.
        // Anything else becomes new scenes at the end of the episode.
        const target = document.elementFromPoint(event.x, event.y);
        const onScene =
          event.paths.length === 1 &&
          target?.closest("[data-drop-zone='scene']") != null;
        if (event.phase === "over") {
          setOverScene(onScene);
          return;
        }

        setOverScene(false);
        const studio = useStudio.getState();
        const [first] = event.paths;
        const kind = first ? mediaFormatFor(first)?.kind : undefined;
        if (onScene && first && kind && studio.selectedSceneId) {
          void studio.importMedia(studio.selectedSceneId, kind, first);
        } else if (studio.activeEpisodeId) {
          void studio.importAsNewScenes(event.paths);
        }
      })
      .then((unlisten) => {
        if (cancelled) unlisten();
        else stop = unlisten;
      });

    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  return overScene;
}

function useSceneShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isTextEntry(event.target)
      )
        return;
      // Leave keys alone while a dialog is open.
      if (document.querySelector("[role='dialog']")) return;
      const studio = useStudio.getState();
      if (event.key === " ") {
        event.preventDefault();
        window.dispatchEvent(new Event("framebop:toggle-playback"));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        studio.selectAdjacentScene(1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        studio.selectAdjacentScene(-1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

export function ScenesView() {
  const episodeState = useStudio((state) => state.episodeState);
  const episodeError = useStudio((state) => state.episodeError);
  const activeEpisodeId = useStudio((state) => state.activeEpisodeId);
  const sceneCount = useStudio((state) => state.scenes.length);
  const hasScript = useStudio(
    (state) => (state.episode?.script.trim().length ?? 0) > 0,
  );
  const openEpisode = useStudio((state) => state.openEpisode);
  const addScene = useStudio((state) => state.addScene);
  const importAsNewScenes = useStudio((state) => state.importAsNewScenes);
  const setTab = useStudio((state) => state.setTab);
  const dropActive = useFileDrop();
  useSceneShortcuts();

  if (!activeEpisodeId)
    return <NoEpisode purpose={t("editor:buildItsScenes")} />;
  if (episodeState === "loading" || episodeState === "idle") {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-5" />
      </div>
    );
  }
  if (episodeState === "error") {
    return (
      <ErrorState
        message={episodeError ?? t("editor:theEpisodeCouldNotBeLoaded")}
        onRetry={() => void openEpisode(activeEpisodeId)}
      />
    );
  }

  if (sceneCount === 0) {
    return (
      <EmptyState
        icon={Clapperboard}
        title={t("editor:noScenesYet")}
        description={
          hasScript
            ? t("editor:addScenesOneAtATime")
            : t("editor:addScenesOneAtATime2")
        }
        action={
          <>
            <Button
              variant="primary"
              icon={Plus}
              onClick={() => void addScene()}
            >
              {t("editor:addAScene")}
            </Button>
            <Button icon={FolderInput} onClick={() => void importAsNewScenes()}>
              {t("editor:importMediaAsScenes")}
            </Button>
            <Button icon={FileText} onClick={() => setTab("script")}>
              {hasScript
                ? t("editor:splitTheScript")
                : t("editor:writeAScript")}
            </Button>
          </>
        }
      />
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <Preview dropActive={dropActive} />
        <Storyboard />
        <Timeline />
      </div>
    </div>
  );
}

/** The selected scene's inspector, as a panel of its own beside the editor. */
export function SceneSidePanel() {
  const activeEpisodeId = useStudio((state) => state.activeEpisodeId);
  const episode = useStudio((state) => state.episode);
  if (!activeEpisodeId || !episode) return null;
  return <Inspector />;
}
