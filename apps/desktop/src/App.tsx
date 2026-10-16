import type { StudioTab } from "@framebop/core";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { type ComponentType, useEffect } from "react";
import { ActivityPanel } from "./components/ActivityPanel";
import { Dialogs, Toasts } from "./components/Dialogs";
import { Sidebar } from "./components/Sidebar";
import { LogoMark } from "./components/Logo";
import { TopBar } from "./components/TopBar";
import { Button, Spinner } from "./components/ui";
import { bridge } from "./lib/bridge";
import { useTranslation } from "react-i18next";
import { useStudio } from "./store/studio";
import { BlueprintView } from "./views/BlueprintView";
import { DoctorView } from "./views/DoctorView";
import { NextStep } from "./components/NextStep";
import { ExportView } from "./views/ExportView";
import { ModelsView } from "./views/ModelsView";
import { ProductionView } from "./views/ProductionView";
import { ProjectDetailPanel, ProjectsView } from "./views/ProjectsView";
import { ResearchView } from "./views/ResearchView";
import { SceneSidePanel, ScenesView } from "./views/ScenesView";
import { ScriptSidePanel, ScriptView } from "./views/ScriptView";
import { t } from "./i18n";

const VIEWS: Record<StudioTab, ComponentType> = {
  projects: ProjectsView,
  script: ScriptView,
  scenes: ScenesView,
  blueprint: BlueprintView,
  production: ProductionView,
  export: ExportView,
  doctor: DoctorView,
  models: ModelsView,
  research: ResearchView,
};

function StartupScreen() {
  const boot = useStudio((state) => state.boot);
  const start = useStudio((state) => state.start);

  return (
    // The whole screen drags the window, since there is no title bar yet.
    <div
      data-tauri-drag-region
      className="app-backdrop flex h-full flex-col items-center justify-center gap-5"
    >
      <LogoMark
        animated={boot.status === "starting"}
        className="pointer-events-none size-20 drop-shadow-[0_12px_28px_rgb(255_122_31/0.35)]"
      />
      {boot.status === "starting" ? (
        <div className="pointer-events-none flex items-center gap-2 text-xs text-fg-muted">
          <Spinner />
          {t("common:openingYourLibrary")}
        </div>
      ) : (
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <h1 className="text-sm font-semibold text-fg">
            {t("common:framebopStudioCouldNotStart")}
          </h1>
          <p data-selectable className="text-xs leading-5 text-fg-muted">
            {boot.error}
          </p>
          <Button
            icon={RotateCcw}
            onClick={async () => {
              useStudio.setState({ boot: { status: "starting", error: null } });
              if (bridge.mode === "desktop")
                await bridge.restartEngine().catch(() => {});
              await start();
            }}
          >
            {t("common:tryAgain")}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Shown if the engine process stops while the application is in use. */
function EngineDownBanner() {
  const reason = useStudio((state) => state.engineDown);
  const restartEngine = useStudio((state) => state.restartEngine);
  if (reason === null) return null;
  return (
    <div
      role="alert"
      className="flex shrink-0 items-center gap-3 border-b border-danger/30 bg-danger/10 px-4 py-2"
    >
      <AlertTriangle className="size-4 shrink-0 text-danger" aria-hidden />
      <p className="min-w-0 flex-1 truncate text-xs text-fg">
        {t("common:theProductionEngineStoppedSoChanges")}{" "}
        <span className="text-fg-muted">{reason}</span>
      </p>
      <Button size="sm" icon={RotateCcw} onClick={() => void restartEngine()}>
        {t("common:restartEngine")}
      </Button>
    </div>
  );
}

export function App() {
  // Re-renders the whole interface when the language changes, without
  // remounting it: no editor, playback or job state is lost.
  useTranslation();
  const bootStatus = useStudio((state) => state.boot.status);
  const tab = useStudio((state) => state.tab);

  useEffect(() => {
    void useStudio.getState().start();
  }, []);

  if (bootStatus !== "ready") return <StartupScreen />;

  const View = VIEWS[tab];
  return (
    <div className="app-backdrop flex h-full flex-col">
      <TopBar />
      <EngineDownBanner />
      <div className="flex min-h-0 flex-1 gap-2 px-2 pb-2">
        {/* Research and Scene Doctor do not work on production projects. */}
        {tab !== "research" && tab !== "doctor" && <Sidebar />}
        <main className="glass-panel flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border">
          {(tab === "script" || tab === "scenes" || tab === "export") && (
            <NextStep />
          )}
          <div className="min-h-0 flex-1">
            <View />
          </div>
        </main>
        {tab === "projects" && <ProjectDetailPanel />}
        {tab === "script" && <ScriptSidePanel />}
        {tab === "scenes" && <SceneSidePanel />}
      </div>
      <ActivityPanel />
      <Dialogs />
      <Toasts />
    </div>
  );
}
