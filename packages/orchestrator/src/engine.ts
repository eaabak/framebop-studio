import { randomUUID } from "node:crypto";
import {
  type AdapterRegistry,
  type HostPlatform,
  QWEN3_TTS_ID,
  SD_CPP_ID,
  SHERPA_ONNX_ID,
  type SecretStore,
  createDefaultRegistry,
  createHostPlatform,
  createSecretStore,
  readQwen3TtsModel,
} from "@framebop/ai-adapters";
import {
  AppError,
  type CatalogEntry,
  type CoreEvent,
  type ErrorShape,
  type Job,
  type RpcMethod,
  type RpcParsedParams,
  type RpcResult,
  isRpcMethod,
  rpcContract,
  toErrorShape,
} from "@framebop/core";
import { openLibraryDatabase } from "@framebop/database";
import { HUGGING_FACE, HubClient, loadCatalog } from "@framebop/model-manager";
import { YOUTUBE_API, YouTubeClient } from "@framebop/research";
import type { EngineContext } from "./context";
import { Logger } from "./logger";
import { acquireLibraryLock } from "./lock";
import {
  type LibraryPaths,
  ensureLibraryDirectories,
  resetWorkDirectory,
  resolveLibraryPaths,
} from "./paths";
import {
  createImportExecutor,
  recordMeasuredMetadata,
  removeMusic,
  removePartialFiles,
  startImport,
  startMusicImport,
} from "./services/assets";
import { exportEpisodeManifest } from "./services/exporter";
import {
  applyJobOutput,
  createGenerationExecutor,
  createGenerationJob,
} from "./services/generation";
import { JobQueue } from "./services/jobs";
import { AnalysisService } from "./services/analysis";
import { type LocalLlmOptions, LocalLlmService } from "./services/llm";
import { ResearchService, YouTubeKeyStore } from "./services/research";
import { BlueprintService } from "./services/blueprint";
import { VisualReferenceService } from "./services/references";
import { DoctorService } from "./services/doctor";
import {
  ImageRuntimeService,
  LlamaRuntimeService,
  VoiceRuntimeService,
} from "./services/runtimes";
import { DirectorService } from "./services/director";
import { ScriptWriterService } from "./services/script-writer";
import { renderBrowser } from "./services/render-browser";
import { StoryService } from "./services/story";
import { VoiceService } from "./services/voices";
import { ModelService } from "./services/models";
import {
  createRenderExecutor,
  forgetRender,
  listRenders,
  previewAnimation,
  previewRender,
  startRender,
} from "./services/render";
import {
  createEpisode,
  createProject,
  deleteEpisode,
  deleteProject,
  getEpisodeDetail,
  listEpisodes,
  listProjects,
  updateEpisode,
  updateProject,
} from "./services/projects";
import {
  clearSceneSlot,
  createScene,
  createScenesFromScript,
  deleteScene,
  duplicateScene,
  reorderScenes,
  updateScene,
} from "./services/scenes";
import { getSettings, updateSettings } from "./services/settings";
import { removeUnreferencedAssets, requireEpisode } from "./services/shared";
import { detectTools, getSystemInfo, listEngines } from "./services/system";

export interface EngineOptions {
  /** Absolute path of the library folder. Created if it does not exist. */
  dataDir: string;
  mirrorLogsToStderr?: boolean;
  /** Overridable for tests. Defaults to the real machine. */
  host?: HostPlatform;
  env?: NodeJS.ProcessEnv;
  /** Engine adapters to offer. Defaults to those that ship with the app. */
  registry?: AdapterRegistry;
  /** Model catalog to offer. Defaults to the curated catalog. */
  modelCatalog?: readonly CatalogEntry[];
  /** Hugging Face endpoint. Tests point this at a local stand-in. */
  huggingFaceEndpoint?: string;
  /**
   * The render worker and its bundled composition (`@framebop/renderer`).
   * Null when this build has none; rendering is then reported unavailable.
   */
  renderer?: { workerPath: string; siteDirectory: string } | null;
  /** YouTube Data API address. Tests point this at a local stand-in. */
  youtubeEndpoint?: string;
  /**
   * Where the YouTube API key is kept. Defaults to the system's secret
   * store; null keeps keys in memory only. Tests pass a fake.
   */
  secretStore?: SecretStore | null;
  /** The secret store's service name, so development can use its own. */
  secretNamespace?: string;
  /** Overrides for the local language model runtime, for tests. */
  llm?: LocalLlmOptions;
}

export interface Engine {
  readonly paths: LibraryPaths;
  /** Validates and executes one RPC call. Rejects with an `ErrorShape`. */
  dispatch(method: string, params: unknown): Promise<unknown>;
  subscribe(listener: (event: CoreEvent) => void): () => void;
  /** Resolves when no background job is queued or running. */
  idle(): Promise<void>;
  close(): Promise<void>;
  /** Shared service dependencies, for transports that serve media directly. */
  readonly context: EngineContext;
}

type Handlers = {
  [M in RpcMethod]: (
    params: RpcParsedParams<M>,
  ) => RpcResult<M> | Promise<RpcResult<M>>;
};

const DELETED = { deleted: true } as const;

/**
 * Opens a library and returns the engine that serves it. The engine has no
 * knowledge of the desktop shell or of any transport: it is driven entirely
 * through `dispatch` and `subscribe`, which is what makes it testable and
 * reusable outside the app.
 */
export async function createEngine(options: EngineOptions): Promise<Engine> {
  const paths = resolveLibraryPaths(options.dataDir);
  await ensureLibraryDirectories(paths);
  // Taken before the database is opened: recovery below must only ever run
  // in the one process that owns the library.
  const releaseLock = acquireLibraryLock(paths.lockPath);

  const listeners = new Set<(event: CoreEvent) => void>();
  const emit = (event: CoreEvent) => {
    for (const listener of listeners) listener(event);
  };

  const log = new Logger({
    filePath: paths.logFile,
    mirrorToStderr: options.mirrorLogsToStderr ?? false,
    onEntry: (entry) => emit({ type: "log", entry }),
  });
  const engineLog = log.scope("engine");

  const host = options.host ?? createHostPlatform();
  const env = options.env ?? process.env;
  const db = openLibraryDatabase(paths.databasePath);

  const ctx: EngineContext = {
    db,
    paths,
    log,
    host,
    env,
    tools: await detectTools(host, env),
    emit,
    now: () => new Date().toISOString(),
    newId: () => randomUUID(),
  };

  await removePartialFiles(ctx);
  await resetWorkDirectory(paths);

  const imageRuntime = new ImageRuntimeService(ctx);
  const voiceRuntime = new VoiceRuntimeService(ctx);
  const llamaRuntime = new LlamaRuntimeService(ctx);
  const registry =
    options.registry ??
    createDefaultRegistry({
      host,
      env,
      ffmpeg: () => ctx.tools.ffmpeg,
      drawThingsHttpPort: () => getSettings(ctx).drawThingsHttpPort,
      kokoroPython: () => getSettings(ctx).kokoroPython,
      qwenTtsPython: () => getSettings(ctx).qwenTtsPython,
      qwenVoicesDirectory: () => getSettings(ctx).qwenVoicesDirectory,
      stableDiffusionCpp: () => imageRuntime.locate(),
      // Read when a model is run; the model service exists by then.
      modelParts: (reference) => models.partsOf(reference),
      sherpaOnnx: {
        runtime: () => voiceRuntime.locate(),
        packs: () => voiceRuntime.packs(),
      },
      remotion: {
        // The worker runs on the same Node.js as the engine: in the
        // installed app, the runtime that ships with it.
        nodePath: process.execPath,
        locate: () =>
          options.renderer
            ? {
                ...options.renderer,
                browserExecutable: renderBrowser(
                  getSettings(ctx).rendererBrowserPath,
                  options.renderer.workerPath,
                ),
              }
            : null,
      },
    });

  const jobs = new JobQueue(ctx);
  jobs.register("media_import", createImportExecutor(ctx));
  const generation = createGenerationExecutor(ctx, registry);
  jobs.register("image_generation", generation);
  jobs.register("video_generation", generation);
  jobs.register("audio_generation", generation);
  jobs.register("video_render", createRenderExecutor(ctx, registry));
  const doctor = new DoctorService(ctx, jobs);
  jobs.register("video_inspection", doctor.executor());

  // The language model runtime is asked about GGUF models like an adapter.
  let llm: LocalLlmService | null = null;
  const models = new ModelService(ctx, {
    catalog: options.modelCatalog ?? loadCatalog(),
    hub: new HubClient(options.huggingFaceEndpoint ?? HUGGING_FACE),
    registry,
    evaluators: [
      {
        id: "llama.cpp",
        name: "llama.cpp",
        task: "research_analysis",
        evaluateModel: (candidate) =>
          (llm as LocalLlmService).evaluateModel(candidate),
      },
    ],
  });
  llm = new LocalLlmService(ctx, models, {
    managedServer: () => llamaRuntime.locate(),
    ...options.llm,
  });
  const scriptWriter = new ScriptWriterService(ctx, llm);

  /** A runtime is not deleted while a job, or anything else, uses it. */
  const refuseWhileUsed = (
    what: string,
    uses: (job: Job) => boolean,
    busy = false,
  ) => {
    if (busy || ctx.db.jobs.listByStatus("running").some(uses)) {
      throw new AppError(
        "CONFLICT",
        `${what} is in use. Wait for it to finish, or stop it, first.`,
      );
    }
  };
  const usesLlm = (job: Job) =>
    job.type === "research_analysis" || job.type === "story_generation";
  models.start();
  const analyses = new AnalysisService(ctx, jobs, llm);
  analyses.recover();
  jobs.register("research_analysis", analyses.executor());
  const stories = new StoryService(ctx, jobs, llm, analyses);
  stories.recover();
  jobs.register("story_generation", stories.executor());
  const blueprints = new BlueprintService(ctx, registry, models);
  const director = new DirectorService(ctx, llm, blueprints);
  const references = new VisualReferenceService(ctx);
  stories.blueprint = blueprints;
  const voices = new VoiceService(ctx, {
    registry,
    // A Base model, which clones from a profile; the full-precision 1.7B
    // first, as the voices were approved with it.
    baseModel: async () => {
      const found: { reference: string; rank: number }[] = [];
      for (const choice of await models.choices(
        "audio_generation",
        QWEN3_TTS_ID,
      )) {
        if (!choice.usable || !choice.reference || choice.kind === "download") {
          continue;
        }
        const model = await readQwen3TtsModel(choice.reference);
        if (model?.kind !== "base") continue;
        found.push({
          reference: choice.reference,
          rank: (model.size === "1.7B" ? 0 : 2) + (model.bits ? 1 : 0),
        });
      }
      return found.sort((a, b) => a.rank - b.rank)[0]?.reference ?? null;
    },
  });

  const research = new ResearchService(
    ctx,
    new YouTubeClient(options.youtubeEndpoint ?? YOUTUBE_API),
    new YouTubeKeyStore(
      options.secretStore !== undefined
        ? options.secretStore
        : await createSecretStore(
            host,
            options.secretNamespace ?? "framebop-studio",
            env,
          ),
      env.FRAMEBOP_YOUTUBE_API_KEY?.trim() || null,
    ),
  );

  const recovery = jobs.recover();
  if (recovery.interrupted > 0) {
    engineLog.warn("Jobs were running when the application last stopped", {
      interrupted: recovery.interrupted,
    });
  }
  if (recovery.heldPending > 0) {
    engineLog.warn("Waiting production jobs are on hold until resumed", {
      waiting: recovery.heldPending,
    });
  }

  const handlers: Handlers = {
    "system.info": () => getSystemInfo(ctx),
    "engines.list": () => listEngines(ctx, registry),

    "settings.get": () => getSettings(ctx),
    "settings.update": ({ patch }) => updateSettings(ctx, patch),

    "projects.list": () => listProjects(ctx),
    "projects.create": (input) => createProject(ctx, input),
    "projects.update": (input) => updateProject(ctx, input),
    "projects.delete": async ({ id }) => {
      await deleteProject(ctx, jobs, id);
      return DELETED;
    },

    "episodes.list": ({ projectId }) => listEpisodes(ctx, projectId),
    "episodes.get": ({ id }) => getEpisodeDetail(ctx, id),
    "episodes.create": (input) => createEpisode(ctx, input),
    "episodes.update": (input) => updateEpisode(ctx, input),
    "episodes.delete": async ({ id }) => {
      await deleteEpisode(ctx, jobs, id);
      return DELETED;
    },

    "scenes.create": (input) => createScene(ctx, input),
    "scenes.update": ({ id, patch }) => {
      const scene = updateScene(ctx, id, patch);
      // A duration set by hand is never replaced by an estimate or a measurement.
      if (patch.durationSeconds !== undefined)
        blueprints.markManualDuration(id);
      return scene;
    },
    "scenes.duplicate": ({ id }) => duplicateScene(ctx, id),
    "scenes.delete": async ({ id }) => {
      await deleteScene(ctx, jobs, id);
      return DELETED;
    },
    "scenes.reorder": (input) => reorderScenes(ctx, input),
    "scenes.createFromScript": (input) =>
      createScenesFromScript(ctx, jobs, input),
    "scenes.clearSlot": ({ sceneId, slot }) =>
      clearSceneSlot(ctx, sceneId, slot),

    "assets.import": (input) => startImport(ctx, jobs, input),
    "episodes.importMusic": (input) => startMusicImport(ctx, jobs, input),
    "episodes.removeMusic": ({ episodeId }) => removeMusic(ctx, episodeId),
    "assets.reportMetadata": (input) => recordMeasuredMetadata(ctx, input),
    "assets.getMany": ({ ids }) => [...db.assets.getMany(ids).values()],

    "jobs.list": ({ limit }) => db.jobs.listRecent(limit),
    "jobs.createGeneration": (input) =>
      createGenerationJob(ctx, jobs, registry, models, references, input),
    "jobs.cancel": ({ id }) => jobs.cancel(id),
    "jobs.retry": ({ id }) => jobs.retry(id),
    "jobs.applyOutput": ({ id }) => applyJobOutput(ctx, id),
    "jobs.clearFinished": async () => {
      const removed = db.jobs.deleteFinished();
      // Results that were kept only by their job are no longer referenced.
      for (const project of db.projects.list()) {
        await removeUnreferencedAssets(ctx, project.id);
      }
      return { removed };
    },

    "hardware.inspect": ({ refresh }) => models.hardware(refresh),
    "models.list": () => models.list(),
    "models.install": ({ modelId }) => models.install(modelId),
    "models.cancel": ({ modelId }) => models.cancel(modelId),
    "models.retry": ({ modelId }) => models.retry(modelId),
    "models.verify": ({ modelId }) => models.verify(modelId),
    "models.remove": async ({ modelId }) => {
      await models.remove(modelId);
      return DELETED;
    },
    "models.storage": () => models.storage(),
    "models.setStorageRoot": ({ path }) => models.setStorageRoot(path),
    "models.sources": () => models.sources(),
    "models.addSource": ({ kind, path }) => models.addSource(kind, path),
    "models.removeSource": ({ id }) => {
      models.removeSource(id);
      return DELETED;
    },
    "models.scanSources": () => models.scanAll(),
    "models.external": () => models.external(),
    "registry.status": () => models.registryStatus(),
    "registry.refresh": () => models.refreshRegistry(),
    "hub.search": (params) => models.searchHub(params),
    "hub.model": ({ repoId }) => models.hubModel(repoId),
    "hub.import": ({ repoId, kit }) => models.importFromHub(repoId, kit),
    "models.removeImported": ({ modelId }) => {
      models.removeImported(modelId);
      return DELETED;
    },
    "models.choices": ({ task, adapterId }) => models.choices(task, adapterId),
    "audio.voices": async ({ adapterId, model }) => {
      const adapter = registry.get("audio_generation", adapterId);
      if (!adapter?.listVoices) {
        throw new AppError("NOT_FOUND", "That engine has no voices to list.");
      }
      // Only folders the model picker offered for this engine are read.
      if (
        !(await models.isOfferedReference("audio_generation", adapterId, model))
      ) {
        throw new AppError(
          "VALIDATION",
          "That model is not one this engine was offered.",
        );
      }
      return adapter.listVoices(model);
    },

    "render.preview": ({ episodeId }) => previewRender(ctx, episodeId),
    "render.start": ({ episodeId }) =>
      startRender(ctx, jobs, registry, episodeId),
    "renders.list": ({ episodeId }) => listRenders(ctx, episodeId),
    "renders.forget": ({ id }) => {
      forgetRender(ctx, id);
      return DELETED;
    },

    "queue.status": () => jobs.status(),
    "queue.setPaused": ({ paused }) => jobs.setPaused(paused),

    "logs.recent": ({ limit }) => log.recent(limit),

    "export.episodeManifest": ({ episodeId, targetPath }) => {
      requireEpisode(ctx, episodeId);
      return exportEpisodeManifest(ctx, episodeId, targetPath);
    },

    "research.projects.list": () => research.listProjects(),
    "research.projects.get": ({ id }) => research.projectDetail(id),
    "research.projects.create": (input) => research.createProject(input),
    "research.projects.update": (input) => research.updateProject(input),
    "research.projects.delete": ({ id }) => {
      research.deleteProject(id);
      return DELETED;
    },
    "research.videos.add": ({ projectId, link }) =>
      research.addVideo(projectId, link),
    "research.videos.get": ({ id }) => research.videoDetail(id),
    "research.videos.update": ({ id, patch }) =>
      research.updateVideoNotes(id, patch.notes),
    "research.videos.remove": ({ id }) => {
      research.removeVideo(id);
      return DELETED;
    },
    "research.metadata.fetch": ({ referenceVideoId }) =>
      research.fetchMetadata(referenceVideoId),
    "research.metadata.saveManual": (input) =>
      research.saveManualMetadata(input),
    "research.metadata.deleteSnapshot": ({ id }) => {
      research.deleteSnapshot(id);
      return DELETED;
    },
    "research.comments.fetch": (input) => research.fetchComments(input),
    "research.comments.list": (input) => research.listComments(input),
    "research.comments.clear": ({ referenceVideoId }) => {
      research.clearComments(referenceVideoId);
      return DELETED;
    },
    "research.transcripts.import": (input) => research.importTranscript(input),
    "research.transcripts.get": ({ id }) => research.transcript(id),
    "research.transcripts.delete": ({ id }) => {
      research.deleteTranscript(id);
      return DELETED;
    },
    "research.notes.create": (input) => research.createNote(input),
    "research.notes.delete": ({ id }) => {
      research.deleteNote(id);
      return DELETED;
    },
    "research.key.status": () => research.keys.status(),
    "research.key.set": ({ apiKey }) => research.keys.set(apiKey),
    "research.key.clear": () => research.keys.clear(),
    "research.analysis.capabilities": async () => {
      const status = await llm.status();
      const ready = status.models.some(
        (model) =>
          model.installation !== "not-installed" &&
          model.installation !== "downloading",
      );
      return research.analysisCapabilities({
        available: status.runtime.available && ready,
        reason: !status.runtime.available
          ? (status.runtime.reason ??
            "The language model runtime is not set up.")
          : ready
            ? `Runs locally with ${status.runtime.version}.`
            : "Download a language model in AI Models.",
      });
    },
    "research.analysis.start": (input) => analyses.start(input),
    "research.analysis.list": ({ referenceVideoId }) =>
      analyses.list(referenceVideoId),
    "research.analysis.get": ({ id }) => analyses.get(id),
    "research.analysis.cancel": ({ id }) => analyses.cancel(id),
    "research.analysis.delete": ({ id }) => {
      analyses.delete(id);
      return DELETED;
    },
    "story.create": (input) => stories.create(input),
    "story.list": ({ researchProjectId }) => stories.list(researchProjectId),
    "story.get": ({ id }) => stories.get(id),
    "story.save": (input) => stories.save(input),
    "story.generate": (input) => stories.generate(input),
    "story.cancel": ({ id }) => stories.cancel(id),
    "story.delete": ({ id }) => {
      stories.delete(id);
      return DELETED;
    },
    "story.createProject": (input) => stories.createProject(input),
    "blueprint.get": ({ episodeId }) => blueprints.get(episodeId),
    "runtimes.imageStatus": () => imageRuntime.status(),
    "runtimes.installImage": () => imageRuntime.install(),
    "runtimes.voiceStatus": () => voiceRuntime.status(),
    "runtimes.llmStatus": () => llamaRuntime.status(),
    "runtimes.installLlm": () => llamaRuntime.install(),
    "script.write": (input) => scriptWriter.write(input),
    "director.capabilities": () => director.capabilities(),
    "director.defaults": ({ sceneId, capability }) =>
      director.defaults(sceneId, capability),
    "director.plan": (input) => director.plan(input),
    "director.cancel": () => {
      director.cancel();
      return DELETED;
    },
    "director.normalize": ({ blueprint }) => director.normalize(blueprint),
    "director.apply": ({ sceneId, blueprint }) =>
      director.apply(sceneId, blueprint),
    "script.cancel": () => {
      scriptWriter.cancel();
      return DELETED;
    },
    "runtimes.installVoice": ({ language }) => voiceRuntime.install(language),
    "runtimes.removeImage": () => {
      refuseWhileUsed(
        "The image runtime",
        (job) => job.adapterId === SD_CPP_ID,
      );
      return imageRuntime.remove();
    },
    "runtimes.removeVoice": () => {
      refuseWhileUsed(
        "The voice runtime",
        (job) => job.adapterId === SHERPA_ONNX_ID,
      );
      return voiceRuntime.removeRuntime();
    },
    "runtimes.removeVoicePack": ({ packId }) => {
      refuseWhileUsed(
        "The voice pack",
        (job) => job.adapterId === SHERPA_ONNX_ID,
      );
      return voiceRuntime.removePack(packId);
    },
    "runtimes.removeLlm": () => {
      refuseWhileUsed("The language-model runtime", usesLlm, llm.inUse());
      return llamaRuntime.remove();
    },
    "voices.list": () => voices.list(),
    "voices.saveRecording": (input) => voices.saveRecording(input),
    "voices.updatePacing": ({ id, pacing }) => voices.updatePacing(id, pacing),
    "voices.delete": async ({ id }) => {
      await voices.remove(id);
      return DELETED;
    },
    "voices.preview": ({ id }) => voices.startPreview(id),
    "voices.previewStatus": () => voices.previewStatus(),
    "doctor.exports": () => doctor.exports(),
    "doctor.inspect": (input) => doctor.inspect(input),
    "doctor.list": () => doctor.list(),
    "doctor.get": ({ id }) => doctor.get(id),
    "doctor.delete": async ({ id }) => {
      await doctor.delete(id);
      return DELETED;
    },
    "visualReferences.list": ({ projectId }) => references.list(projectId),
    "visualReferences.save": (input) => references.save(input),
    "visualReferences.delete": ({ id }) => {
      references.delete(id);
      return DELETED;
    },
    "blueprint.updatePlan": ({ sceneId, patch }) =>
      blueprints.updatePlan(sceneId, patch),
    "blueprint.animationPreview": ({ sceneId }) =>
      previewAnimation(ctx, sceneId),
    "blueprint.applyAnimationTemplate": ({ sceneId, template }) =>
      blueprints.applyAnimationTemplate(sceneId, template),
    "blueprint.preflight": ({ episodeId }) => blueprints.preflight(episodeId),
    "blueprint.useMeasuredDuration": ({ sceneId }) =>
      blueprints.useMeasuredDuration(sceneId),
    "blueprint.suggestNarration": (input) => stories.suggestNarration(input),
    "blueprint.acceptNarration": ({ sceneId }) =>
      blueprints.acceptProposal(sceneId),
    "blueprint.discardNarration": ({ sceneId }) => {
      blueprints.setProposal(sceneId, null, null);
      return blueprints.updatePlan(sceneId, {});
    },
    "llm.status": () => llm.status(),
    "llm.test": async ({ modelId }) => {
      // A test loads a model too: never next to a running generation job.
      if (
        db.jobs
          .listRecent(500)
          .some(
            (job) => job.status === "running" && job.type !== "media_import",
          )
      ) {
        throw new AppError(
          "CONFLICT",
          "Wait until the running production job finishes, then test the model.",
        );
      }
      return llm.test(modelId);
    },
    "llm.unload": async () => {
      await llm.unload();
      return llm.status();
    },
  };

  async function dispatch(method: string, params: unknown): Promise<unknown> {
    try {
      if (!isRpcMethod(method)) {
        throw new AppError("NOT_FOUND", `Unknown method "${method}".`);
      }
      const parsed = rpcContract[method].params.safeParse(params ?? {});
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const where = issue?.path.join(".");
        throw new AppError(
          "VALIDATION",
          issue
            ? where
              ? `${where}: ${issue.message}`
              : issue.message
            : "Invalid request.",
          { issues: parsed.error.issues },
        );
      }
      // The handler table is keyed by method, so the pairing is sound even
      // though TypeScript cannot follow it through the dynamic lookup.
      const handler = handlers[method] as (input: unknown) => unknown;
      const startedAt = performance.now();
      const result = await handler(parsed.data);
      // Debug entries go to the log file only. They make it possible to see
      // from a bug report what the interface asked for and how long it took.
      engineLog.debug(method, {
        ms: Math.round(performance.now() - startedAt),
      });
      return result;
    } catch (error) {
      const shape: ErrorShape = toErrorShape(error);
      if (shape.code === "INTERNAL") {
        engineLog.error(`${method} failed unexpectedly`, {
          reason: shape.message,
          stack: error instanceof Error ? error.stack : undefined,
        });
      }
      throw shape;
    }
  }

  jobs.start();

  engineLog.info("Engine ready", {
    dataDir: paths.dataDir,
    schemaVersion: db.schemaVersion,
    platform: host.os,
    ffmpeg: ctx.tools.ffmpeg.version,
  });

  let closed = false;
  return {
    paths,
    context: ctx,
    dispatch,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    idle: async () => {
      await jobs.idle();
      await models.idle();
    },
    async close() {
      if (closed) return;
      closed = true;
      await llm.unload();
      await models.shutdown();
      await jobs.shutdown();
      engineLog.info("Engine stopped");
      listeners.clear();
      db.close();
      releaseLock();
      await log.close();
    },
  };
}
