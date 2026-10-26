import {
  type AppSettings,
  type AppSettingsPatch,
  type Asset,
  type CoreEvent,
  DEFAULT_SETTINGS,
  type EngineStatus,
  type Episode,
  type EpisodeSummary,
  type ExternalModel,
  galleryStatusOf,
  type HardwareInventory,
  type HubKit,
  type ImageRuntimeStatus,
  isActiveJob,
  type Job,
  type LogEntry,
  mediaFormatFor,
  type ModelSource,
  type ModelStatus,
  type ParameterValue,
  type ProjectSummary,
  type QueueStatus,
  type RegistryStatus,
  type RenderPreview,
  type RenderRecord,
  type RpcParams,
  type Scene,
  type ScenePatch,
  type SceneSlot,
  type StorageReport,
  type StudioTab,
  type SystemInfo,
  type VoiceSetupStatus,
} from "@framebop/core";
import { create } from "zustand";
import { EngineError, bridge } from "../lib/bridge";
import { confirm } from "../lib/dialogs";
import { applyLanguagePreference, formatBytes, t } from "../i18n";
import { jobLabel } from "../lib/jobLabels";
import { errorMessage } from "../lib/errors";

export type LoadState = "idle" | "loading" | "ready" | "error";

/**
 * saved   - nothing waiting to be written
 * pending - edits are queued and will be written shortly
 * saving  - a write is in progress
 * error   - the last write failed; edits are kept and can be retried
 */
export type SaveState = "saved" | "pending" | "saving" | "error";

/** What Framebop installed itself besides catalog models. */
export interface FramebopRuntimes {
  image: ImageRuntimeStatus;
  voice: VoiceSetupStatus;
  llm: ImageRuntimeStatus;
}

/** One of those runtimes, or one voice pack. */
export type RuntimeTarget = "image" | "voice" | "llm" | { packId: string };

export interface Toast {
  id: number;
  tone: "error" | "success" | "info";
  message: string;
}

type EpisodeEdit = Partial<Pick<Episode, "title" | "script">>;

export interface GenerationRequest {
  sceneId: string;
  task: "image_generation" | "video_generation" | "audio_generation";
  engine: EngineStatus;
  model: string | null;
  /** For images and clips; narration has no size. */
  width?: number;
  height?: number;
  parameters: Record<string, ParameterValue>;
  /** As edited. Omitted: the scene's own prompt. */
  prompt?: string;
  negativePrompt?: string;
  /** Null or omitted: a new random seed. */
  seed?: number | null;
  /** Omitted: the scene's image for clips, none for pictures. */
  inputImageAssetId?: string | null;
  clipSeconds?: number;
  visualReferenceIds?: string[];
  /**
   * True when the button pressed already said what the run does and how
   * long it takes, so no second question is asked.
   */
  confirmed?: boolean;
}

interface RestoreTarget {
  episodeId?: string | null;
  sceneId?: string | null;
}

interface StudioState {
  boot: { status: "starting" | "ready" | "failed"; error: string | null };
  /** Set when the engine process stops while the app is running. */
  engineDown: string | null;
  system: SystemInfo | null;
  settings: AppSettings;
  engines: EngineStatus[];
  enginesState: LoadState;

  tab: StudioTab;
  projects: ProjectSummary[];
  activeProjectId: string | null;
  episodes: EpisodeSummary[];
  episodesState: LoadState;
  activeEpisodeId: string | null;
  episode: Episode | null;
  scenes: Scene[];
  episodeState: LoadState;
  episodeError: string | null;
  selectedSceneId: string | null;
  /** Every asset seen so far, by id. */
  assets: Record<string, Asset>;

  jobs: Job[];
  /** Whether the production lane is running jobs or holding them. */
  queue: QueueStatus;
  logs: LogEntry[];
  /** Catalog models with installation, compatibility and runnability. */
  models: ModelStatus[];
  modelsState: LoadState;
  hardware: HardwareInventory | null;
  hardwareState: LoadState;
  modelStorage: StorageReport | null;
  modelSources: ModelSource[];
  externalModels: ExternalModel[];
  registryStatus: RegistryStatus | null;
  runtimes: FramebopRuntimes | null;
  /**
   * A model chosen in the gallery to use in a scene. The Generate section
   * picks it up, selects it, and clears it.
   */
  generationIntent: {
    task: "image_generation" | "video_generation" | "audio_generation";
    adapterId: string;
    reference: string;
    modelName: string;
  } | null;
  /** Exported videos of the open episode, newest first. */
  renders: RenderRecord[];
  /** What the open episode would render as now. */
  renderPreview: RenderPreview | null;
  renderState: LoadState;
  saveState: SaveState;
  toasts: Toast[];

  start(): Promise<void>;
  restartEngine(): Promise<void>;
  setTab(tab: StudioTab): void;
  notify(tone: Toast["tone"], message: string): void;
  dismissToast(id: number): void;
  updateSettings(patch: AppSettingsPatch): Promise<void>;
  refreshEngines(): Promise<void>;
  refreshProjects(): Promise<void>;

  createProject(input: RpcParams<"projects.create">): Promise<boolean>;
  updateProject(
    id: string,
    patch: RpcParams<"projects.update">["patch"],
  ): Promise<void>;
  deleteProject(id: string): Promise<void>;
  openProject(id: string, restore?: RestoreTarget): Promise<void>;

  createEpisode(title: string): Promise<boolean>;
  deleteEpisode(id: string): Promise<void>;
  openEpisode(id: string, sceneId?: string | null): Promise<void>;
  editEpisode(patch: EpisodeEdit): void;
  createScenesFromScript(mode: "append" | "replace"): Promise<void>;

  selectScene(id: string | null): void;
  selectAdjacentScene(offset: 1 | -1): boolean;
  editScene(id: string, patch: ScenePatch): void;
  addScene(afterSceneId?: string): Promise<void>;
  duplicateScene(id: string): Promise<void>;
  deleteScene(id: string): Promise<void>;
  reorderScenes(orderedIds: string[]): Promise<void>;
  moveScene(id: string, offset: 1 | -1): Promise<void>;

  importMedia(
    sceneId: string,
    slot: SceneSlot,
    sourcePath?: string,
  ): Promise<void>;
  importAsNewScenes(paths?: string[]): Promise<void>;
  clearSlot(sceneId: string, slot: SceneSlot): Promise<void>;
  /**
   * Passes on dimensions and duration learned while displaying an asset the
   * engine could not analyse. Does nothing when nothing is missing.
   */
  reportAssetMetadata(
    asset: Asset,
    measured: { width: number; height: number; durationSeconds: number | null },
  ): void;

  /**
   * Queues a production job for a scene. Asks for confirmation first when the
   * chosen engine's runs are expensive.
   */
  createGenerationJob(request: GenerationRequest): Promise<void>;
  /** Puts a finished job's result into its scene, replacing what is there. */
  applyJobOutput(jobId: string): Promise<void>;
  setQueuePaused(paused: boolean): Promise<void>;
  refreshModels(): Promise<void>;
  refreshHardware(refresh: boolean): Promise<void>;
  /** Shows the download size, files and licence, and downloads on approval. */
  installModel(status: ModelStatus): Promise<void>;
  cancelModelDownload(modelId: string): Promise<void>;
  retryModelDownload(modelId: string): Promise<void>;
  verifyModel(modelId: string): Promise<void>;
  removeModel(modelId: string): Promise<void>;
  refreshRuntimes(): Promise<void>;
  /** Shows the space it frees, and deletes it on approval. */
  removeRuntime(target: RuntimeTarget): Promise<void>;
  addModelSource(kind: ModelSource["kind"], path?: string): Promise<void>;
  removeModelSource(source: ModelSource): Promise<void>;
  scanModelSources(): Promise<void>;
  changeModelStorage(useDefault: boolean): Promise<void>;
  refreshRenders(): Promise<void>;
  /** Fetches the registry from the address in settings. */
  refreshRegistry(): Promise<void>;
  /** Adds a runnable Hugging Face repository to the user's models. */
  /** `kit`: the parts chosen from a repository of separate weights. */
  importFromHub(repoId: string, kit?: HubKit): Promise<ModelStatus | null>;
  forgetImported(modelId: string): Promise<void>;
  /** Opens the Scenes tab with this model selected for generation. */
  useModelInScene(status: ModelStatus): Promise<void>;
  clearGenerationIntent(): void;
  startRender(): Promise<void>;
  forgetRender(id: string): Promise<void>;
  openRender(render: RenderRecord): Promise<void>;
  revealRender(render: RenderRecord): Promise<void>;
  changeExportDirectory(useDefault: boolean): Promise<void>;
  importMusic(): Promise<void>;
  removeMusic(): Promise<void>;
  setMusicVolume(volume: number): Promise<void>;
  /**
   * Chooses a program in Settings (a speech engine's Python, Remotion's
   * browser, llama-server), or the folder of Qwen3-TTS voice profiles.
   */
  chooseProgram(
    setting:
      | "kokoroPython"
      | "qwenTtsPython"
      | "ltxVideoPython"
      | "ltxVideoModelDirectory"
      | "ltxVideoTextEncoderDirectory"
      | "qwenVoicesDirectory"
      | "rendererBrowserPath"
      | "llamaServerPath",
  ): Promise<void>;
  retryJob(id: string): Promise<void>;
  cancelJob(id: string): Promise<void>;
  clearFinishedJobs(): Promise<void>;

  /** Writes any queued edits now. Resolves when the engine has them. */
  flush(): Promise<void>;
  exportManifest(): Promise<void>;
}

const SAVE_DELAY_MS = 450;
const MAX_LOG_ENTRIES = 500;

// Edits typed into the inspector are applied to the store at once and written
// to the engine after a short pause, merged per scene, so typing never waits
// on a round trip and a burst of keystrokes becomes one write.
const pendingSceneEdits = new Map<string, ScenePatch>();
let pendingEpisodeEdit: { id: string; patch: EpisodeEdit } | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saveChain: Promise<void> = Promise.resolve();
let sessionTimer: ReturnType<typeof setTimeout> | undefined;
let started = false;
let nextToastId = 1;

const messageOf = errorMessage;

function indexAssets(assets: Asset[]): Record<string, Asset> {
  return Object.fromEntries(assets.map((asset) => [asset.id, asset]));
}

export const useStudio = create<StudioState>((set, get) => {
  /** Runs an engine call, turning a failure into a toast. */
  async function attempt<T>(
    work: () => Promise<T>,
    fallback: string,
  ): Promise<T | undefined> {
    try {
      return await work();
    } catch (error) {
      get().notify("error", messageOf(error, fallback));
      return undefined;
    }
  }

  function hasPendingEdits(): boolean {
    return pendingSceneEdits.size > 0 || pendingEpisodeEdit !== null;
  }

  function scheduleSave(): void {
    set({ saveState: "pending" });
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void get().flush(), SAVE_DELAY_MS);
  }

  async function writePendingEdits(): Promise<void> {
    if (!hasPendingEdits()) return;
    set({ saveState: "saving" });

    const sceneEdits = [...pendingSceneEdits];
    pendingSceneEdits.clear();
    const episodeEdit = pendingEpisodeEdit;
    pendingEpisodeEdit = null;
    let failed = false;
    let rejected = false;

    const handleFailure = (error: unknown, restore: () => void) => {
      const code = error instanceof EngineError ? error.code : "UNREACHABLE";
      if (code === "VALIDATION" || code === "NOT_FOUND") {
        // The engine will never accept this edit; keeping it would retry
        // forever. Drop it and resynchronise below.
        rejected = true;
        get().notify(
          "error",
          messageOf(error, t("studio:aChangeCouldNotBeSaved")),
        );
      } else {
        failed = true;
        restore();
      }
    };

    for (const [id, patch] of sceneEdits) {
      try {
        const saved = await bridge.call("scenes.update", { id, patch });
        set((state) => ({
          scenes: state.scenes.map((scene) =>
            scene.id === id ? { ...scene, updatedAt: saved.updatedAt } : scene,
          ),
        }));
      } catch (error) {
        handleFailure(error, () => {
          // Newer edits made while saving win over the ones that failed.
          pendingSceneEdits.set(id, { ...patch, ...pendingSceneEdits.get(id) });
        });
      }
    }

    if (episodeEdit) {
      try {
        await bridge.call("episodes.update", episodeEdit);
      } catch (error) {
        handleFailure(error, () => {
          pendingEpisodeEdit = {
            id: episodeEdit.id,
            patch: { ...episodeEdit.patch, ...pendingEpisodeEdit?.patch },
          };
        });
      }
    }

    if (rejected) await reloadEpisode();
    if (failed) {
      set({ saveState: "error" });
      get().notify("error", t("studio:yourLatestChangesCouldNotBe"));
    } else {
      set({ saveState: hasPendingEdits() ? "pending" : "saved" });
      // Durations feed the project totals shown in the sidebar.
      void get().refreshProjects();
    }
  }

  async function reloadEpisode(): Promise<void> {
    const id = get().activeEpisodeId;
    if (!id) return;
    const detail = await bridge.call("episodes.get", { id });
    if (get().activeEpisodeId !== id) return;
    set((state) => ({
      episode: detail.episode,
      scenes: detail.scenes,
      assets: { ...state.assets, ...indexAssets(detail.assets) },
      selectedSceneId: detail.scenes.some(
        (scene) => scene.id === state.selectedSceneId,
      )
        ? state.selectedSceneId
        : (detail.scenes[0]?.id ?? null),
    }));
    syncEpisodeSummary();
  }

  /** Keeps the sidebar's counts for the open episode in step with its scenes. */
  function syncEpisodeSummary(): void {
    const { activeEpisodeId, scenes, assets, episode } = get();
    if (!activeEpisodeId) return;
    const coverId = scenes
      .map((scene) => scene.videoAssetId ?? scene.imageAssetId)
      .find((id) => id !== null);
    set((state) => ({
      episodes: state.episodes.map((summary) =>
        summary.id === activeEpisodeId
          ? {
              ...summary,
              title: episode?.title ?? summary.title,
              sceneCount: scenes.length,
              totalDurationSeconds: scenes.reduce(
                (total, scene) => total + scene.durationSeconds,
                0,
              ),
              coverAsset: coverId ? (assets[coverId] ?? null) : null,
            }
          : summary,
      ),
    }));
  }

  /** Applies a structural change, then reloads so local order matches the engine. */
  async function structuralChange<T>(
    work: () => Promise<T>,
    fallback: string,
  ): Promise<T | undefined> {
    await get().flush();
    const result = await attempt(work, fallback);
    await attempt(reloadEpisode, t("studio:theEpisodeCouldNotBeReloaded"));
    void get().refreshProjects();
    return result;
  }

  function handleEvent(event: CoreEvent): void {
    switch (event.type) {
      case "log":
        set((state) => ({
          logs: [...state.logs, event.entry].slice(-MAX_LOG_ENTRIES),
        }));
        return;

      case "model.updated":
        set((state) => ({
          models: state.models.map((status) =>
            status.entry.id === event.installation.modelId
              ? {
                  ...status,
                  installation: event.installation,
                  gallery: galleryStatusOf({
                    ...status,
                    installation: event.installation,
                  }),
                }
              : status,
          ),
        }));
        // Finishing changes what is runnable and how much space is used.
        if (
          ["installed", "failed", "cancelled"].includes(
            event.installation.state,
          )
        ) {
          void get().refreshModels();
        }
        return;

      case "model.removed":
        void get().refreshModels();
        return;

      case "queue.updated":
        set({ queue: event.queue });
        return;

      case "job.updated": {
        const previous = get().jobs.find((job) => job.id === event.job.id);
        set((state) => ({
          jobs: previous
            ? state.jobs.map((job) =>
                job.id === event.job.id ? event.job : job,
              )
            : [event.job, ...state.jobs],
        }));
        void loadJobOutputs([event.job]);
        if (
          event.job.type === "video_render" &&
          event.job.episodeId === get().activeEpisodeId &&
          previous?.status !== event.job.status &&
          !["pending", "running"].includes(event.job.status)
        ) {
          void get().refreshRenders();
        }
        if (event.job.status === "failed" && previous?.status !== "failed") {
          get().notify(
            "error",
            t("studio:failed", {
              label: jobLabel(event.job.label),
              event: event.job.error?.message ?? t("studio:unknownError"),
            }),
          );
        }
        return;
      }

      case "episode.updated": {
        if (event.episode.id !== get().activeEpisodeId) return;
        set((state) => ({
          episode: state.episode
            ? {
                ...state.episode,
                musicAssetId: event.episode.musicAssetId,
                musicVolume: event.episode.musicVolume,
              }
            : state.episode,
          assets: { ...state.assets, ...indexAssets(event.assets) },
        }));
        void get().refreshRenders();
        return;
      }

      case "scene.updated": {
        // Local edits not yet written must survive an update from the engine.
        const local = pendingSceneEdits.get(event.scene.id);
        set((state) => ({
          assets: { ...state.assets, ...indexAssets(event.assets) },
          scenes: state.scenes.map((scene) =>
            scene.id === event.scene.id ? { ...event.scene, ...local } : scene,
          ),
        }));
        syncEpisodeSummary();
        void get().refreshProjects();
        return;
      }
    }
  }

  /**
   * Fetches the assets that jobs produced but that no open scene uses yet, so
   * a result can be shown before it is put into a scene.
   */
  async function loadJobOutputs(jobs: readonly Job[]): Promise<void> {
    const known = get().assets;
    const ids = [
      ...new Set(
        jobs.flatMap((job) =>
          job.outputAssetId && !known[job.outputAssetId]
            ? [job.outputAssetId]
            : [],
        ),
      ),
    ];
    if (ids.length === 0) return;
    try {
      const assets = await bridge.call("assets.getMany", { ids });
      set((state) => ({ assets: { ...state.assets, ...indexAssets(assets) } }));
    } catch {
      // The thumbnail is a nicety; the job row works without it.
    }
  }

  function persistSessionSoon(): void {
    clearTimeout(sessionTimer);
    sessionTimer = setTimeout(() => {
      const { tab, activeProjectId, activeEpisodeId, selectedSceneId } = get();
      void get().updateSettings({
        session: {
          tab,
          projectId: activeProjectId,
          episodeId: activeEpisodeId,
          sceneId: selectedSceneId,
        },
      });
    }, 600);
  }

  return {
    boot: { status: "starting", error: null },
    engineDown: null,
    system: null,
    settings: DEFAULT_SETTINGS,
    engines: [],
    enginesState: "idle",

    tab: "projects",
    projects: [],
    activeProjectId: null,
    episodes: [],
    episodesState: "idle",
    activeEpisodeId: null,
    episode: null,
    scenes: [],
    episodeState: "idle",
    episodeError: null,
    selectedSceneId: null,
    assets: {},

    jobs: [],
    queue: {
      paused: false,
      pausedReason: null,
      pendingCount: 0,
      runningCount: 0,
    },
    logs: [],
    models: [],
    modelsState: "idle",
    hardware: null,
    hardwareState: "idle",
    modelStorage: null,
    modelSources: [],
    externalModels: [],
    registryStatus: null,
    runtimes: null,
    generationIntent: null,
    renders: [],
    renderPreview: null,
    renderState: "idle",
    saveState: "saved",
    toasts: [],

    async start() {
      // React's development mode mounts twice; the engine must be set up once.
      if (started) return;
      started = true;
      try {
        const [system, settings, projects, jobs, logs, queue] =
          await Promise.all([
            bridge.call("system.info", {}),
            bridge.call("settings.get", {}),
            bridge.call("projects.list", {}),
            bridge.call("jobs.list", {}),
            bridge.call("logs.recent", {}),
            bridge.call("queue.status", {}),
          ]);
        bridge.setMediaRoot(system.mediaRoot);
        await applyLanguagePreference(
          settings.uiLanguage,
          system.preferredLanguages,
        ).catch(() => undefined);
        set({ system, settings, projects, jobs, logs, queue });
        void loadJobOutputs(jobs);

        await bridge.subscribe(handleEvent);
        await bridge.onEngineStatus((status) => {
          set({
            engineDown: status.state === "stopped" ? status.reason : null,
          });
        });
        bridge.onBeforeClose(() => get().flush());

        const { session } = settings;
        if (
          session.projectId &&
          projects.some((p) => p.id === session.projectId)
        ) {
          await get().openProject(session.projectId, session);
        }
        set({ tab: session.tab, boot: { status: "ready", error: null } });

        useStudio.subscribe((state, previous) => {
          if (
            state.tab !== previous.tab ||
            state.activeProjectId !== previous.activeProjectId ||
            state.activeEpisodeId !== previous.activeEpisodeId ||
            state.selectedSceneId !== previous.selectedSceneId
          ) {
            persistSessionSoon();
          }
        });
        void get().refreshEngines();
      } catch (error) {
        started = false;
        set({
          boot: {
            status: "failed",
            error: messageOf(error, t("studio:theEngineDidNotRespond")),
          },
        });
      }
    },

    async restartEngine() {
      await attempt(async () => {
        await bridge.restartEngine();
        set({ engineDown: null });
        await reloadEpisode();
        set({
          jobs: await bridge.call("jobs.list", {}),
          queue: await bridge.call("queue.status", {}),
        });
      }, t("studio:theEngineCouldNotBeRestarted"));
    },

    setTab(tab) {
      set({ tab });
      if (tab === "projects") void get().refreshProjects();
      if (tab === "production") void get().refreshEngines();
    },

    notify(tone, message) {
      const id = nextToastId++;
      set((state) => ({
        toasts: [...state.toasts.slice(-3), { id, tone, message }],
      }));
      // Errors stay until dismissed; confirmations clear themselves.
      if (tone !== "error") setTimeout(() => get().dismissToast(id), 4000);
    },

    dismissToast(id) {
      set((state) => ({
        toasts: state.toasts.filter((toast) => toast.id !== id),
      }));
    },

    async updateSettings(patch) {
      set((state) => ({
        settings: { ...state.settings, ...patch } as AppSettings,
      }));
      if (patch.uiLanguage) {
        // Switches at once; the saved choice follows.
        void applyLanguagePreference(
          patch.uiLanguage,
          get().system?.preferredLanguages ?? [],
        );
      }
      try {
        await bridge.call("settings.update", { patch });
        // The model list reports the registry address and what engines can
        // run, which these settings change.
        if (
          "registryUrl" in patch ||
          "kokoroPython" in patch ||
          "qwenTtsPython" in patch ||
          "ltxVideoPython" in patch ||
          "ltxVideoModelDirectory" in patch ||
          "ltxVideoTextEncoderDirectory" in patch ||
          "qwenVoicesDirectory" in patch ||
          "rendererBrowserPath" in patch ||
          "llamaServerPath" in patch
        ) {
          if (get().modelsState !== "idle") void get().refreshModels();
        }
      } catch (error) {
        // Session bookkeeping failing is not worth interrupting the user for.
        if (!("session" in patch)) {
          get().notify(
            "error",
            messageOf(error, t("studio:theSettingCouldNotBeSaved")),
          );
        }
      }
    },

    async refreshEngines() {
      set({ enginesState: get().engines.length ? "ready" : "loading" });
      try {
        const engines = await bridge.call("engines.list", {});
        set({
          engines,
          enginesState: "ready",
          system: await bridge.call("system.info", {}),
        });
      } catch {
        set({ enginesState: "error" });
      }
    },

    async refreshProjects() {
      try {
        set({ projects: await bridge.call("projects.list", {}) });
      } catch {
        // A background refresh; the next successful one corrects the list.
      }
    },

    async createProject(input) {
      const project = await attempt(
        () => bridge.call("projects.create", input),
        t("studio:theProjectCouldNotBeCreated"),
      );
      if (!project) return false;
      await get().refreshProjects();
      await get().openProject(project.id);
      return true;
    },

    async updateProject(id, patch) {
      const saved = await attempt(
        () => bridge.call("projects.update", { id, patch }),
        t("studio:theProjectCouldNotBeSaved"),
      );
      if (!saved) return;
      set((state) => ({
        projects: state.projects.map((project) =>
          project.id === id ? { ...project, ...saved } : project,
        ),
      }));
    },

    async deleteProject(id) {
      const project = get().projects.find((candidate) => candidate.id === id);
      if (!project) return;
      const confirmed = await confirm({
        title: t("studio:delete", { name: project.name }),
        message: t("studio:thisPermanentlyDeletesTheProjectIts"),
        confirmLabel: t("studio:deleteProject"),
        tone: "danger",
      });
      if (!confirmed) return;

      // Edits queued for a project that is about to disappear are moot.
      clearTimeout(saveTimer);
      pendingSceneEdits.clear();
      pendingEpisodeEdit = null;
      const deleted = await attempt(
        () => bridge.call("projects.delete", { id }),
        t("studio:theProjectCouldNotBeDeleted"),
      );
      if (!deleted) return;
      if (get().activeProjectId === id) {
        set({
          activeProjectId: null,
          episodes: [],
          episodesState: "idle",
          activeEpisodeId: null,
          episode: null,
          scenes: [],
          episodeState: "idle",
          selectedSceneId: null,
          saveState: "saved",
        });
      }
      set((state) => ({
        jobs: state.jobs.filter((job) => job.projectId !== id),
      }));
      await get().refreshProjects();
    },

    async openProject(id, restore) {
      if (get().activeProjectId === id && !restore) return;
      await get().flush();
      set({
        activeProjectId: id,
        episodes: [],
        episodesState: "loading",
        activeEpisodeId: null,
        episode: null,
        scenes: [],
        episodeState: "idle",
        episodeError: null,
        selectedSceneId: null,
      });
      try {
        const episodes = await bridge.call("episodes.list", { projectId: id });
        if (get().activeProjectId !== id) return;
        set({ episodes, episodesState: "ready" });
        const target =
          episodes.find((episode) => episode.id === restore?.episodeId) ??
          episodes[0];
        if (target) await get().openEpisode(target.id, restore?.sceneId);
      } catch (error) {
        if (get().activeProjectId !== id) return;
        set({ episodesState: "error" });
        get().notify(
          "error",
          messageOf(error, t("studio:theProjectCouldNotBeOpened")),
        );
      }
    },

    async createEpisode(title) {
      const projectId = get().activeProjectId;
      if (!projectId) return false;
      const episode = await attempt(
        () => bridge.call("episodes.create", { projectId, title }),
        t("studio:theEpisodeCouldNotBeCreated"),
      );
      if (!episode) return false;
      set({ episodes: await bridge.call("episodes.list", { projectId }) });
      await get().openEpisode(episode.id);
      void get().refreshProjects();
      return true;
    },

    async deleteEpisode(id) {
      const summary = get().episodes.find((episode) => episode.id === id);
      const projectId = get().activeProjectId;
      if (!summary || !projectId) return;
      const confirmed = await confirm({
        title: t("studio:delete2", { title: summary.title }),
        message: t("studio:deleteEpisodeMessage", {
          count: summary.sceneCount,
        }),
        confirmLabel: t("studio:deleteEpisode"),
        tone: "danger",
      });
      if (!confirmed) return;

      if (get().activeEpisodeId === id) {
        clearTimeout(saveTimer);
        pendingSceneEdits.clear();
        pendingEpisodeEdit = null;
      }
      const deleted = await attempt(
        () => bridge.call("episodes.delete", { id }),
        t("studio:theEpisodeCouldNotBeDeleted"),
      );
      if (!deleted) return;
      const episodes = await bridge.call("episodes.list", { projectId });
      set({ episodes });
      if (get().activeEpisodeId === id) {
        set({
          activeEpisodeId: null,
          episode: null,
          scenes: [],
          episodeState: "idle",
          selectedSceneId: null,
          saveState: "saved",
        });
        if (episodes[0]) await get().openEpisode(episodes[0].id);
      }
      void get().refreshProjects();
    },

    async openEpisode(id, sceneId) {
      if (get().activeEpisodeId === id && get().episodeState === "ready")
        return;
      await get().flush();
      set({
        activeEpisodeId: id,
        episode: null,
        scenes: [],
        episodeState: "loading",
        episodeError: null,
        selectedSceneId: null,
      });
      try {
        const detail = await bridge.call("episodes.get", { id });
        if (get().activeEpisodeId !== id) return;
        set((state) => ({
          episode: detail.episode,
          scenes: detail.scenes,
          assets: { ...state.assets, ...indexAssets(detail.assets) },
          episodeState: "ready",
          selectedSceneId:
            detail.scenes.find((scene) => scene.id === sceneId)?.id ??
            detail.scenes[0]?.id ??
            null,
        }));
      } catch (error) {
        if (get().activeEpisodeId !== id) return;
        set({
          episodeState: "error",
          episodeError: messageOf(
            error,
            t("studio:theEpisodeCouldNotBeLoaded"),
          ),
        });
      }
    },

    editEpisode(patch) {
      const { episode } = get();
      if (!episode) return;
      set({ episode: { ...episode, ...patch } });
      pendingEpisodeEdit = {
        id: episode.id,
        patch: { ...pendingEpisodeEdit?.patch, ...patch },
      };
      if (patch.title !== undefined) syncEpisodeSummary();
      scheduleSave();
    },

    async createScenesFromScript(mode) {
      const { episode, scenes } = get();
      if (!episode) return;
      if (mode === "replace" && scenes.length > 0) {
        const confirmed = await confirm({
          title: t("studio:replaceAllScenes"),
          message: t("studio:replaceScenesMessage", { count: scenes.length }),
          confirmLabel: t("studio:replaceScenes"),
          tone: "danger",
        });
        if (!confirmed) return;
      }
      const created = await structuralChange(
        () =>
          bridge.call("scenes.createFromScript", {
            episodeId: episode.id,
            mode,
          }),
        t("studio:scenesCouldNotBeCreatedFrom"),
      );
      if (!created) return;
      const added =
        mode === "replace" ? created.length : created.length - scenes.length;
      get().notify(
        "success",
        t("studio:createdScenesFromScript", { count: added }),
      );
      set({ tab: "scenes" });
    },

    selectScene(id) {
      set({ selectedSceneId: id });
    },

    selectAdjacentScene(offset) {
      const { scenes, selectedSceneId } = get();
      const index = scenes.findIndex((scene) => scene.id === selectedSceneId);
      const next = scenes[index + offset];
      if (index === -1 || !next) return false;
      set({ selectedSceneId: next.id });
      return true;
    },

    editScene(id, patch) {
      set((state) => ({
        scenes: state.scenes.map((scene) =>
          scene.id === id ? { ...scene, ...patch } : scene,
        ),
      }));
      pendingSceneEdits.set(id, { ...pendingSceneEdits.get(id), ...patch });
      if (patch.durationSeconds !== undefined) syncEpisodeSummary();
      scheduleSave();
    },

    async addScene(afterSceneId) {
      const episodeId = get().activeEpisodeId;
      if (!episodeId) return;
      const scene = await structuralChange(
        () => bridge.call("scenes.create", { episodeId, afterSceneId }),
        t("studio:theSceneCouldNotBeAdded"),
      );
      if (scene) set({ selectedSceneId: scene.id });
    },

    async duplicateScene(id) {
      const copy = await structuralChange(
        () => bridge.call("scenes.duplicate", { id }),
        t("studio:theSceneCouldNotBeDuplicated"),
      );
      if (copy) set({ selectedSceneId: copy.id });
    },

    async deleteScene(id) {
      const { scenes } = get();
      const index = scenes.findIndex((scene) => scene.id === id);
      const scene = scenes[index];
      if (!scene) return;
      const hasContent =
        scene.imageAssetId ||
        scene.videoAssetId ||
        scene.audioAssetId ||
        scene.narrationText ||
        scene.imagePrompt ||
        scene.motionPrompt;
      if (hasContent) {
        const confirmed = await confirm({
          title: t("studio:deleteScene", { value: index + 1 }),
          message: t("studio:itsTextAndSettingsAreDeleted"),
          confirmLabel: t("studio:deleteScene2"),
          tone: "danger",
        });
        if (!confirmed) return;
      }
      pendingSceneEdits.delete(id);
      // Keep the selection next to where the deleted scene was.
      const neighbour = scenes[index + 1] ?? scenes[index - 1];
      await structuralChange(
        () => bridge.call("scenes.delete", { id }),
        t("studio:theSceneCouldNotBeDeleted"),
      );
      if (get().selectedSceneId === id || !get().selectedSceneId) {
        set({ selectedSceneId: neighbour?.id ?? get().scenes[0]?.id ?? null });
      }
    },

    async reorderScenes(orderedIds) {
      const { activeEpisodeId: episodeId, scenes } = get();
      if (!episodeId) return;
      const byId = new Map(scenes.map((scene) => [scene.id, scene]));
      const reordered = orderedIds.flatMap((id, index) => {
        const scene = byId.get(id);
        return scene ? [{ ...scene, sequenceIndex: index }] : [];
      });
      // Show the new order immediately; the engine confirms or corrects it.
      set({ scenes: reordered });
      await structuralChange(
        () =>
          bridge.call("scenes.reorder", {
            episodeId,
            orderedSceneIds: orderedIds,
          }),
        t("studio:theNewSceneOrderCouldNot"),
      );
    },

    async moveScene(id, offset) {
      const ids = get().scenes.map((scene) => scene.id);
      const from = ids.indexOf(id);
      const to = from + offset;
      if (from === -1 || to < 0 || to >= ids.length) return;
      ids.splice(to, 0, ...ids.splice(from, 1));
      await get().reorderScenes(ids);
    },

    async importMedia(sceneId, slot, sourcePath) {
      const path =
        sourcePath ?? (await bridge.chooseMediaFiles([slot], false))[0];
      if (!path) return;
      await attempt(
        () => bridge.call("assets.import", { sceneId, slot, sourcePath: path }),
        t("studio:theFileCouldNotBeImported"),
      );
    },

    async importAsNewScenes(paths) {
      const episodeId = get().activeEpisodeId;
      if (!episodeId) return;
      const chosen =
        paths ?? (await bridge.chooseMediaFiles(["image", "video"], true));
      if (chosen.length === 0) return;
      await get().flush();

      let created = 0;
      const skipped: string[] = [];
      let lastSceneId: string | null = null;
      for (const path of chosen) {
        const kind = mediaFormatFor(path)?.kind;
        if (kind !== "image" && kind !== "video") {
          skipped.push(path.split(/[\\/]/).pop() ?? path);
          continue;
        }
        const scene = await attempt(
          () => bridge.call("scenes.create", { episodeId }),
          t("studio:aSceneCouldNotBeCreated"),
        );
        if (!scene) break;
        lastSceneId = scene.id;
        created += 1;
        await attempt(
          () =>
            bridge.call("assets.import", {
              sceneId: scene.id,
              slot: kind,
              sourcePath: path,
            }),
          t("studio:aFileCouldNotBeImported"),
        );
      }

      await attempt(reloadEpisode, t("studio:theEpisodeCouldNotBeReloaded"));
      if (lastSceneId) set({ selectedSceneId: lastSceneId });
      if (skipped.length > 0) {
        get().notify(
          "error",
          t("studio:skippedOnlyImageAndVideoFiles", {
            skipped: skipped.join(", "),
          }),
        );
      } else if (created > 1) {
        get().notify("success", t("studio:addedScenes", { created }));
      }
      void get().refreshProjects();
    },

    async clearSlot(sceneId, slot) {
      const confirmed = await confirm({
        title: t("studio:removeSlotFromScene", {
          slot: t(
            slot === "image"
              ? "studio:theImage"
              : slot === "video"
                ? "studio:theVideoClip"
                : "studio:theNarrationAudio",
          ),
        }),
        message: t("studio:theLibrarySCopyIsDeleted"),
        confirmLabel: t("studio:removeMedia"),
        tone: "danger",
      });
      if (!confirmed) return;
      const scene = await attempt(
        () => bridge.call("scenes.clearSlot", { sceneId, slot }),
        t("studio:theMediaCouldNotBeRemoved"),
      );
      if (!scene) return;
      handleEvent({ type: "scene.updated", scene, assets: [] });
    },

    reportAssetMetadata(asset, measured) {
      const valid = (value: number | null): value is number =>
        value !== null && Number.isFinite(value) && value > 0;
      const width = valid(measured.width) ? Math.round(measured.width) : null;
      const height = valid(measured.height)
        ? Math.round(measured.height)
        : null;
      const durationSeconds =
        asset.kind !== "image" && valid(measured.durationSeconds)
          ? measured.durationSeconds
          : null;
      const fillsGap =
        (asset.width === null && width !== null) ||
        (asset.height === null && height !== null) ||
        (asset.durationSeconds === null && durationSeconds !== null);
      if (!fillsGap) return;
      // A convenience, so a failure is not worth interrupting the user for.
      bridge
        .call("assets.reportMetadata", {
          assetId: asset.id,
          width,
          height,
          durationSeconds,
        })
        .then((updated) => {
          set((state) => ({
            assets: { ...state.assets, [updated.id]: updated },
          }));
        })
        .catch(() => {});
    },

    async createGenerationJob(request) {
      const capability = request.engine.capabilities.find(
        (candidate) => candidate.task === request.task,
      );
      if (!capability) return;
      // The job captures the scene as it is stored, so store it first.
      await get().flush();

      if (capability.expensive && !request.confirmed) {
        const confirmed = await confirm({
          title: t("studio:start", { name: request.engine.name }),
          message: [
            t("studio:willRunARealModelOn", { name: request.engine.name }),
            capability.supportsCancellation
              ? t("studio:youCanStopItWhileIt")
              : t("studio:itCannotBeStoppedOnceIt"),
            capability.reportsProgress
              ? ""
              : t("studio:itReportsNoProgressSoYou"),
          ]
            .filter(Boolean)
            .join(" "),
          confirmLabel: t("studio:startGeneration"),
        });
        if (!confirmed) return;
      }

      await attempt(
        () =>
          bridge.call("jobs.createGeneration", {
            sceneId: request.sceneId,
            task: request.task,
            adapterId: request.engine.id,
            model: request.model,
            width: request.width,
            height: request.height,
            parameters: request.parameters,
            prompt: request.prompt,
            negativePrompt: request.negativePrompt,
            seed: request.seed ?? null,
            inputImageAssetId: request.inputImageAssetId,
            clipSeconds: request.clipSeconds,
            visualReferenceIds: request.visualReferenceIds,
            approvedExpensive: capability.expensive,
          }),
        t("studio:theJobCouldNotBeCreated"),
      );
    },

    async applyJobOutput(jobId) {
      await get().flush();
      const scene = await attempt(
        () => bridge.call("jobs.applyOutput", { id: jobId }),
        t("studio:theResultCouldNotBePut"),
      );
      if (scene) void get().refreshProjects();
    },

    async setQueuePaused(paused) {
      const queue = await attempt(
        () => bridge.call("queue.setPaused", { paused }),
        t("studio:theQueueCouldNotBeChanged"),
      );
      if (queue) set({ queue });
    },

    async refreshRegistry() {
      const status = await attempt(
        () => bridge.call("registry.refresh", {}),
        t("studio:theRegistryCouldNotBeUpdated"),
      );
      if (status) {
        get().notify(
          "success",
          status.source === "remote"
            ? t("studio:registryIsNowInUse", {
                registryVersion: status.registryVersion,
              })
            : (status.lastError ?? t("studio:theRegistryThatShipsWithThe")),
        );
      }
      await get().refreshModels();
    },

    async importFromHub(repoId, kit) {
      const status = await attempt(
        () => bridge.call("hub.import", { repoId, ...(kit ? { kit } : {}) }),
        t("studio:theModelCouldNotBeAdded"),
      );
      if (status) {
        get().notify(
          "success",
          t("studio:wasAddedToYourModelsNothing", { name: status.entry.name }),
        );
        await get().refreshModels();
      }
      return status ?? null;
    },

    async forgetImported(modelId) {
      await attempt(
        () => bridge.call("models.removeImported", { modelId }),
        t("studio:theModelCouldNotBeRemoved"),
      );
      await get().refreshModels();
    },

    async useModelInScene(status) {
      const engine = status.runnability.adapters.find(
        (adapter) => adapter.usable,
      );
      if (!engine) return;
      const categories = status.entry.categories;
      const task = categories.includes("text-to-speech")
        ? "audio_generation"
        : categories.includes("image-to-video") ||
            categories.includes("text-to-video")
          ? "video_generation"
          : "image_generation";
      const choices = await attempt(
        () =>
          bridge.call("models.choices", { task, adapterId: engine.adapterId }),
        t("studio:theModelCouldNotBePrepared"),
      );
      const choice = choices?.find(
        (candidate) =>
          candidate.modelId === status.entry.id &&
          candidate.usable &&
          candidate.kind !== "download" &&
          candidate.reference !== null,
      );
      if (!choice?.reference) {
        get().notify(
          "error",
          t("studio:doesNotOfferThisModelFor", {
            adapterName: engine.adapterName,
          }),
        );
        return;
      }
      set({
        generationIntent: {
          task,
          adapterId: engine.adapterId,
          reference: choice.reference,
          modelName: status.entry.name,
        },
      });
      get().setTab("scenes");
      if (!get().selectedSceneId) {
        get().notify("info", t("studio:selectASceneTheModelIs"));
      }
    },

    clearGenerationIntent() {
      set({ generationIntent: null });
    },

    async refreshRenders() {
      const episodeId = get().activeEpisodeId;
      if (!episodeId) {
        set({ renders: [], renderPreview: null, renderState: "idle" });
        return;
      }
      if (get().renderState === "idle") set({ renderState: "loading" });
      try {
        const [renders, renderPreview] = await Promise.all([
          bridge.call("renders.list", { episodeId }),
          bridge.call("render.preview", { episodeId }),
        ]);
        if (get().activeEpisodeId !== episodeId) return;
        set({ renders, renderPreview, renderState: "ready" });
      } catch (error) {
        set({ renderState: "error" });
        get().notify(
          "error",
          messageOf(error, t("studio:theRendersCouldNotBeListed")),
        );
      }
    },

    async startRender() {
      const episodeId = get().activeEpisodeId;
      if (!episodeId) return;
      // The render captures the episode as stored, so store edits first.
      await get().flush();
      await attempt(
        () => bridge.call("render.start", { episodeId }),
        t("studio:theRenderCouldNotBeStarted"),
      );
    },

    async forgetRender(id) {
      const confirmed = await confirm({
        title: t("studio:removeThisRenderFromTheList"),
        message: t("studio:onlyTheEntryIsRemovedThe"),
        confirmLabel: t("studio:removeFromList"),
      });
      if (!confirmed) return;
      await attempt(
        () => bridge.call("renders.forget", { id }),
        t("studio:theRenderCouldNotBeRemoved"),
      );
      await get().refreshRenders();
    },

    async openRender(render) {
      await bridge
        .openVideo(render.path)
        .catch((error) =>
          get().notify(
            "error",
            messageOf(error, t("studio:theVideoCouldNotBeOpened")),
          ),
        );
    },

    async revealRender(render) {
      await bridge
        .revealInFileManager(render.path)
        .catch((error) =>
          get().notify(
            "error",
            messageOf(error, t("studio:theFolderCouldNotBeOpened")),
          ),
        );
    },

    async changeExportDirectory(useDefault) {
      const path = useDefault
        ? null
        : await bridge.chooseFolder(
            t("studio:chooseWhereFinishedVideosAreSaved"),
          );
      if (!useDefault && !path) return;
      await get().updateSettings({ exportDirectory: path });
    },

    async importMusic() {
      const episodeId = get().activeEpisodeId;
      if (!episodeId) return;
      const [path] = await bridge.chooseMediaFiles(["audio"], false);
      if (!path) return;
      await attempt(
        () =>
          bridge.call("episodes.importMusic", { episodeId, sourcePath: path }),
        t("studio:theMusicCouldNotBeImported"),
      );
    },

    async removeMusic() {
      const episodeId = get().activeEpisodeId;
      if (!episodeId) return;
      await attempt(
        () => bridge.call("episodes.removeMusic", { episodeId }),
        t("studio:theMusicCouldNotBeRemoved"),
      );
    },

    async setMusicVolume(volume) {
      const episodeId = get().activeEpisodeId;
      if (!episodeId) return;
      const episode = await attempt(
        () =>
          bridge.call("episodes.update", {
            id: episodeId,
            patch: { musicVolume: volume },
          }),
        t("studio:theMusicVolumeCouldNotBe"),
      );
      if (episode) {
        set((state) => ({
          episode: state.episode
            ? { ...state.episode, musicVolume: volume }
            : null,
        }));
        void get().refreshRenders();
      }
    },

    async chooseProgram(setting) {
      const path = [
        "qwenVoicesDirectory",
        "ltxVideoModelDirectory",
        "ltxVideoTextEncoderDirectory",
      ].includes(setting)
        ? await bridge.chooseFolder(
            setting === "qwenVoicesDirectory"
              ? t("studio:chooseTheFolderOfVoiceProfiles")
              : t("video:chooseModelFolder"),
          )
        : await bridge.chooseFile(
            setting === "ltxVideoPython"
              ? t("video:choosePython")
              : setting === "kokoroPython"
                ? t("studio:chooseAPythonInterpreterThatHas")
                : setting === "qwenTtsPython"
                  ? t("studio:chooseAPythonInterpreterWithMlxAudio")
                  : setting === "llamaServerPath"
                    ? t("studio:chooseLlamaServerFromALlama")
                    : t("studio:chooseAChromeBuildForRendering"),
          );
      if (!path) return;
      await get().updateSettings({ [setting]: path });
      void get().refreshEngines();
    },

    async refreshModels() {
      if (get().modelsState === "idle") set({ modelsState: "loading" });
      try {
        const [
          models,
          modelStorage,
          modelSources,
          externalModels,
          registryStatus,
        ] = await Promise.all([
          bridge.call("models.list", {}),
          bridge.call("models.storage", {}),
          bridge.call("models.sources", {}),
          bridge.call("models.external", {}),
          bridge.call("registry.status", {}),
        ]);
        // Progress events keep arriving while the list is fetched. A list
        // answer must not replace an installation record that is newer.
        const live = new Map(
          get().models.map((status) => [status.entry.id, status.installation]),
        );
        set({
          models: models.map((status) => {
            const current = live.get(status.entry.id);
            return current &&
              status.installation?.id === current.id &&
              current.updatedAt > status.installation.updatedAt
              ? { ...status, installation: current }
              : status;
          }),
          modelStorage,
          modelSources,
          externalModels,
          registryStatus,
          modelsState: "ready",
        });
      } catch (error) {
        set({ modelsState: "error" });
        get().notify(
          "error",
          messageOf(error, t("studio:theModelListCouldNotBe")),
        );
      }
    },

    async refreshHardware(refresh) {
      set({ hardwareState: get().hardware ? "ready" : "loading" });
      try {
        set({
          hardware: await bridge.call("hardware.inspect", { refresh }),
          hardwareState: "ready",
        });
      } catch (error) {
        set({ hardwareState: "error" });
        get().notify(
          "error",
          messageOf(error, t("studio:theHardwareCouldNotBeInspected")),
        );
      }
    },

    async installModel(status) {
      const { entry } = status;
      const available = get().modelStorage?.availableBytes;
      const existing = status.external[0];
      const confirmed = await confirm({
        title: existing
          ? t("studio:isAlreadyOnThisComputer", { name: entry.name })
          : t("studio:download", { name: entry.name }),
        message: [
          existing
            ? t("studio:aCopyWasFoundAtRead", { path: existing.path })
            : "",
          t("studio:downloadFromHub", {
            size: formatBytes(status.downloadSizeBytes),
            count: entry.files.length,
            repoId: entry.repoId,
            commit: entry.revision.slice(0, 8),
          }),
          available != null
            ? t("studio:isFreeWhereModelsAreStored", {
                available: formatBytes(available),
              })
            : "",
          t("studio:licence", {
            name: entry.license.name,
            summary: entry.license.summary,
          }),
          status.runnability.adapters.some((adapter) => adapter.usable)
            ? ""
            : t("studio:noEngineInThisVersionCan"),
        ]
          .filter(Boolean)
          .join(" "),
        confirmLabel: existing
          ? t("studio:downloadACopyAnyway")
          : t("studio:download2"),
      });
      if (!confirmed) return;
      const installation = await attempt(
        () =>
          bridge.call("models.install", { modelId: entry.id, approved: true }),
        t("studio:theDownloadCouldNotBeStarted"),
      );
      if (installation) await get().refreshModels();
    },

    async cancelModelDownload(modelId) {
      const confirmed = await confirm({
        title: t("studio:cancelThisDownload"),
        message: t("studio:theDownloadStopsAndThePart"),
        confirmLabel: t("studio:cancelDownload"),
        tone: "danger",
      });
      if (!confirmed) return;
      await attempt(
        () => bridge.call("models.cancel", { modelId }),
        t("studio:theDownloadCouldNotBeCancelled"),
      );
      await get().refreshModels();
    },

    async retryModelDownload(modelId) {
      await attempt(
        () => bridge.call("models.retry", { modelId }),
        t("studio:theDownloadCouldNotBeRestarted"),
      );
      await get().refreshModels();
    },

    async verifyModel(modelId) {
      const installation = await attempt(
        () => bridge.call("models.verify", { modelId }),
        t("studio:theInstallationCouldNotBeChecked"),
      );
      if (installation?.verification === "verified") {
        get().notify("success", t("studio:everyFileMatchesItsPublishedHash"));
      }
      await get().refreshModels();
    },

    async removeModel(modelId) {
      const status = get().models.find(
        (candidate) => candidate.entry.id === modelId,
      );
      const confirmed = await confirm({
        title: t("studio:remove2", {
          entry: status?.entry.name ?? "this model",
        }),
        message: t("studio:itsDownloadedFilesAreDeletedFrom"),
        confirmLabel: t("studio:removeModel"),
        tone: "danger",
      });
      if (!confirmed) return;
      await attempt(
        () => bridge.call("models.remove", { modelId }),
        t("studio:theModelCouldNotBeRemoved2"),
      );
      await get().refreshModels();
    },

    async refreshRuntimes() {
      try {
        const [image, voice, llm] = await Promise.all([
          bridge.call("runtimes.imageStatus", {}),
          bridge.call("runtimes.voiceStatus", {}),
          bridge.call("runtimes.llmStatus", {}),
        ]);
        set({ runtimes: { image, voice, llm } });
      } catch (error) {
        get().notify(
          "error",
          messageOf(error, t("studio:theRuntimesCouldNotBeRead")),
        );
      }
    },

    async removeRuntime(target) {
      const runtimes = get().runtimes;
      if (!runtimes) return;
      const pack =
        typeof target === "object"
          ? runtimes.voice.packs.find((item) => item.id === target.packId)
          : undefined;
      const runtime =
        target === "image"
          ? runtimes.image
          : target === "llm"
            ? runtimes.llm
            : target === "voice"
              ? runtimes.voice.runtime
              : undefined;
      const name =
        pack?.name ?? (runtime ? `${runtime.name} ${runtime.version}` : "");
      const bytes = pack?.installedBytes ?? runtime?.installedBytes ?? null;
      const confirmed = await confirm({
        title: t("studio:removeRuntimeTitle", { name }),
        message: [
          bytes === null
            ? ""
            : t("studio:removeRuntimeFrees", { size: formatBytes(bytes) }),
          pack
            ? t("studio:removeVoicePackMessage")
            : t("studio:removeRuntimeMessage"),
        ]
          .filter(Boolean)
          .join(" "),
        confirmLabel: t("studio:removeRuntimeConfirm"),
        tone: "danger",
      });
      if (!confirmed) return;
      const removed = await attempt(async () => {
        const approved = true as const;
        if (typeof target === "object") {
          await bridge.call("runtimes.removeVoicePack", {
            approved,
            packId: target.packId,
          });
        } else if (target === "image") {
          await bridge.call("runtimes.removeImage", { approved });
        } else if (target === "voice") {
          await bridge.call("runtimes.removeVoice", { approved });
        } else {
          await bridge.call("runtimes.removeLlm", { approved });
        }
        return true;
      }, t("studio:theRuntimeCouldNotBeRemoved"));
      if (removed) {
        get().notify(
          "success",
          bytes === null
            ? t("studio:runtimeRemoved", { name })
            : t("studio:runtimeRemovedFreed", {
                name,
                size: formatBytes(bytes),
              }),
        );
      }
      await get().refreshRuntimes();
    },

    async addModelSource(kind, path) {
      const chosen =
        path ??
        (await bridge.chooseFolder(
          t("studio:chooseAFolderThatContainsModels"),
        ));
      if (!chosen) return;
      const source = await attempt(
        () => bridge.call("models.addSource", { kind, path: chosen }),
        t("studio:theFolderCouldNotBeAdded"),
      );
      if (source) await get().refreshModels();
    },

    async removeModelSource(source) {
      await attempt(
        () => bridge.call("models.removeSource", { id: source.id }),
        t("studio:theFolderCouldNotBeRemoved"),
      );
      await get().refreshModels();
    },

    async scanModelSources() {
      await attempt(
        () => bridge.call("models.scanSources", {}),
        t("studio:theFoldersCouldNotBeScanned"),
      );
      await get().refreshModels();
    },

    async changeModelStorage(useDefault) {
      const path = useDefault
        ? null
        : await bridge.chooseFolder(t("studio:chooseWhereNewModelsAreStored"));
      if (!useDefault && !path) return;
      const report = await attempt(
        () => bridge.call("models.setStorageRoot", { path }),
        t("studio:theStorageLocationCouldNotBe"),
      );
      if (report) set({ modelStorage: report });
    },

    async retryJob(id) {
      const job = get().jobs.find((candidate) => candidate.id === id);
      // Retrying an expensive job starts an expensive run; say so first.
      if (job?.metadata.expensive === true) {
        const confirmed = await confirm({
          title: t("studio:runThisJobAgain"),
          message: t("studio:runsARealModelOnThis", {
            label: jobLabel(job.label),
          }),
          confirmLabel: t("studio:runAgain"),
        });
        if (!confirmed) return;
      }
      await attempt(
        () => bridge.call("jobs.retry", { id }),
        t("studio:theJobCouldNotBeRetried"),
      );
    },

    async cancelJob(id) {
      await attempt(
        () => bridge.call("jobs.cancel", { id }),
        t("studio:theJobCouldNotBeCancelled"),
      );
    },

    async clearFinishedJobs() {
      await attempt(async () => {
        await bridge.call("jobs.clearFinished", {});
        set({ jobs: await bridge.call("jobs.list", {}) });
      }, t("studio:finishedJobsCouldNotBeCleared"));
    },

    flush() {
      clearTimeout(saveTimer);
      // Chained so two flushes never write the same edits concurrently.
      saveChain = saveChain.then(writePendingEdits);
      return saveChain;
    },

    async exportManifest() {
      const { episode } = get();
      if (!episode) return;
      await get().flush();
      const safeName =
        episode.title.replace(/[^\p{L}\p{N} _-]+/gu, "").trim() || "episode";
      const targetPath = await bridge.chooseSavePath(`${safeName}.json`);
      if (!targetPath) return;
      const result = await attempt(
        () =>
          bridge.call("export.episodeManifest", {
            episodeId: episode.id,
            targetPath,
          }),
        t("studio:theManifestCouldNotBeWritten"),
      );
      if (result)
        get().notify(
          "success",
          t("studio:manifestWrittenTo", { path: result.path }),
        );
    },
  };
});

/** The scene currently shown in the preview and inspector, if any. */
export function useSelectedScene(): Scene | null {
  return useStudio(
    (state) =>
      state.scenes.find((scene) => scene.id === state.selectedSceneId) ?? null,
  );
}
