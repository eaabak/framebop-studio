/**
 * The model manager: catalog, downloads, managed storage and external models.
 *
 * Downloads run in this engine process, never in the interface, one model at
 * a time and one file at a time, so a large download cannot starve the disk
 * or the network. Their state lives in SQLite. A download that was running
 * when the process stopped is marked "interrupted" on the next start and is
 * never resumed on its own: nothing is downloaded at startup.
 *
 * Ownership is the central safety rule. Framebop deletes only files inside
 * installation folders it created and recorded; models found elsewhere (the
 * Hugging Face cache, a folder the user chose, another application's files)
 * are external and read-only, and no code path here can delete them.
 */
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative } from "node:path";
import { pipeline } from "node:stream/promises";
import {
  type AdapterRegistry,
  type AnyAdapter,
  type ModelCandidate,
  type ModelEvaluation,
  type ResolvedModelParts,
  inspectHardware,
} from "@framebop/ai-adapters";
import {
  AppError,
  type CatalogEntry,
  CatalogEntrySchema,
  type ExternalModel,
  type GenerationCategory,
  type HardwareInventory,
  type HubKit,
  type ModelChoice,
  type ModelFile,
  type ModelInstallation,
  type ModelPart,
  type ModelRunnability,
  type ModelSource,
  type ModelStatus,
  type RegistryManifest,
  type RegistryStatus,
  type StorageReport,
  downloadSizeOf,
  galleryStatusOf,
  formatBytes,
  isActiveInstallation,
  toErrorShape,
} from "@framebop/core";
import {
  BUNDLED_REGISTRY,
  FileDigest,
  type HubClient,
  entryFromHub,
  entryFromKit,
  fetchRegistry,
  hubModelDetails,
  isNewerRegistry,
  parseRegistry,
  searchHub,
  bytesOnDisk,
  checkAgainstRevision,
  downloadVerifiedFile,
  evaluateCompatibility,
  freeBytes,
  huggingFaceCachePath,
  partialPathOf,
  pathInInstallation,
  removeInstallationFiles,
  scanHuggingFaceCache,
  scanModelFolder,
  validateStorageRoot,
  writeMarker,
} from "@framebop/model-manager";
import type { EngineContext } from "../context";
import { getSettings, updateSettings } from "./settings";

/** The production task an engine performs with a model of each kind. */
const TASK_OF_MODEL: Record<CatalogEntry["task"], string> = {
  image: "image_generation",
  video: "video_generation",
  image_to_video: "video_generation",
  audio: "audio_generation",
  text: "research_analysis",
  other: "",
};

/** Kept free on top of a download, so finishing it never fills the disk. */
const FREE_SPACE_MARGIN = 512 * 1024 * 1024;
const PROGRESS_INTERVAL_MS = 250;

const gigabytes = (bytes: number) =>
  bytes >= 1e9
    ? `${(bytes / 1e9).toFixed(1)} GB`
    : `${(bytes / 1e6).toFixed(0)} MB`;

interface ActiveDownload {
  modelId: string;
  abort: AbortController;
  /** Set when the user cancels, as opposed to the engine shutting down. */
  cancelled: boolean;
  done: Promise<void>;
}

export interface ModelServiceOptions {
  /** The registry's models as shipped with this build. */
  catalog: readonly CatalogEntry[];
  /** Version of that shipped registry. */
  bundled?: { registryVersion: string; publishedAt: string };
  hub: HubClient;
  registry: AdapterRegistry;
  fetchImpl?: typeof fetch;
  /**
   * Engines outside the adapter registry that load model files, such as the
   * local language model runtime. Asked like adapters.
   */
  evaluators?: readonly ModelEvaluator[];
}

export interface ModelEvaluator {
  readonly id: string;
  readonly name: string;
  readonly task: string;
  evaluateModel(candidate: ModelCandidate): Promise<ModelEvaluation>;
}

/** The registry fetched on request and kept, when it is valid. */
interface RemoteRegistry {
  manifest: RegistryManifest;
  url: string;
  fetchedAt: string;
}

export class ModelService {
  /** Registry models in use, plus the user's imports. Rebuilt on change. */
  private catalog: Map<string, CatalogEntry>;
  private remote: RemoteRegistry | null = null;
  private imported: CatalogEntry[] = [];
  private registryError: string | null = null;
  private readonly waiting: string[] = [];
  private active: ActiveDownload | null = null;
  private stopping = false;
  private hardwareCache: HardwareInventory | null = null;
  private idleWaiters: (() => void)[] = [];

  constructor(
    private readonly ctx: EngineContext,
    private readonly options: ModelServiceOptions,
  ) {
    this.catalog = new Map(options.catalog.map((entry) => [entry.id, entry]));
  }

  private get bundled() {
    return (
      this.options.bundled ?? {
        registryVersion: BUNDLED_REGISTRY.registryVersion,
        publishedAt: BUNDLED_REGISTRY.publishedAt,
      }
    );
  }

  /** A fetched registry is used only while it is newer than the shipped one. */
  private remoteInUse(): RemoteRegistry | null {
    if (!this.remote) return null;
    return isNewerRegistry(this.remote.manifest, {
      ...this.bundled,
      schemaVersion: 1,
      models: [],
    })
      ? this.remote
      : null;
  }

  /** Every model offered now: registry models, then the user's imports. */
  entries(): CatalogEntry[] {
    return [...this.catalog.values()];
  }

  private rebuildCatalog(): void {
    const registry =
      this.remoteInUse()?.manifest.models ?? this.options.catalog;
    const entries = [...registry];
    for (const entry of this.imported) {
      if (!entries.some((existing) => existing.id === entry.id)) {
        entries.push(entry);
      }
    }
    this.catalog = new Map(entries.map((entry) => [entry.id, entry]));
    // Entries an installation refers to are kept in the database even when
    // a newer registry drops them, so the installation stays explainable.
    this.ctx.db.models.syncCatalog(entries, this.ctx.now());
  }

  /** Reads the kept registry and imports, then settles leftovers. */
  start(): void {
    const log = this.ctx.log.scope("models");
    const cached = this.ctx.db.models.getRegistryCache();
    if (cached) {
      try {
        this.remote = {
          manifest: parseRegistry(JSON.parse(cached.manifestJson)),
          url: cached.url,
          fetchedAt: cached.fetchedAt,
        };
      } catch (error) {
        // A registry this build cannot read is set aside, not trusted.
        this.registryError = toErrorShape(error).message;
        log.warn("The kept registry could not be read", {
          error: this.registryError,
        });
      }
    }
    for (const row of this.ctx.db.models.listImported()) {
      const parsed = CatalogEntrySchema.safeParse(
        JSON.parse(row.definitionJson),
      );
      if (parsed.success) this.imported.push(parsed.data);
      else log.warn("An imported model could not be read", { id: row.id });
    }
    this.rebuildCatalog();
    const interrupted = this.ctx.db.models.markActiveAsInterrupted(
      this.ctx.now(),
    );
    if (interrupted > 0) {
      this.ctx.log
        .scope("models")
        .warn("Downloads were interrupted by the last shutdown", {
          interrupted,
        });
    }
  }

  // ----------------------------------------------------------- registry

  registryStatus(): RegistryStatus {
    const inUse = this.remoteInUse();
    return {
      source: inUse ? "remote" : "bundled",
      registryVersion:
        inUse?.manifest.registryVersion ?? this.bundled.registryVersion,
      publishedAt: inUse?.manifest.publishedAt ?? this.bundled.publishedAt,
      bundledVersion: this.bundled.registryVersion,
      remoteUrl: getSettings(this.ctx).registryUrl,
      fetchedAt: this.remote?.fetchedAt ?? null,
      lastError: this.registryError,
      modelCount: this.entries().length - this.imported.length,
      importedCount: this.imported.length,
    };
  }

  /**
   * Fetches the registry from the address in settings, only because the
   * user asked. A registry that fails validation changes nothing: the one in
   * use stays in use, and the reason is reported.
   */
  async refreshRegistry(): Promise<RegistryStatus> {
    const url = getSettings(this.ctx).registryUrl;
    if (!url) {
      throw new AppError(
        "VALIDATION",
        "No registry address is set. The registry that ships with the app is in use.",
      );
    }
    let manifest: RegistryManifest;
    try {
      manifest = await fetchRegistry(url, this.options.fetchImpl);
    } catch (error) {
      this.registryError = toErrorShape(error).message;
      throw error;
    }
    const fetchedAt = this.ctx.now();
    this.ctx.db.models.setRegistryCache(
      url,
      JSON.stringify(manifest),
      fetchedAt,
    );
    this.remote = { manifest, url, fetchedAt };
    this.registryError = isNewerRegistry(manifest, {
      ...this.bundled,
      schemaVersion: 1,
      models: [],
    })
      ? null
      : `The registry at that address (${manifest.registryVersion}) is not newer than the one in the app (${this.bundled.registryVersion}), so the app's is used.`;
    this.rebuildCatalog();
    this.ctx.log.scope("models").info("Registry updated", {
      url,
      registryVersion: manifest.registryVersion,
      models: manifest.models.length,
    });
    return this.registryStatus();
  }

  // ------------------------------------------------------- hugging face

  searchHub(params: {
    query: string;
    category: GenerationCategory | null;
    cursor: string | null;
    sort: "downloads" | "likes" | "trending" | "recent";
  }) {
    return searchHub(this.options.hub, params);
  }

  async hubModel(repoId: string) {
    const { recipeFiles: _files, ...details } = await hubModelDetails(
      this.options.hub,
      repoId,
      this.entries(),
    );
    return details;
  }

  /**
   * Adds a repository that an engine in this build can run, pinned to the
   * commit just inspected. Nothing is downloaded: it becomes a model the
   * user can install like any other.
   */
  async importFromHub(repoId: string, kit?: HubKit): Promise<ModelStatus> {
    const details = await hubModelDetails(
      this.options.hub,
      repoId,
      this.entries(),
    );
    if (details.support.state === "registry") {
      throw new AppError("CONFLICT", details.support.reason);
    }
    const today = this.ctx.now().slice(0, 10);
    const entry = kit
      ? entryFromKit(details, kit, new Set(this.catalog.keys()), today)
      : entryFromHub(details, today);
    if (this.catalog.has(entry.id)) {
      throw new AppError(
        "CONFLICT",
        "That model is already among your models.",
      );
    }
    this.ctx.db.models.insertImported(
      entry.id,
      entry.repoId,
      JSON.stringify(entry),
      this.ctx.now(),
    );
    this.imported.push(entry);
    this.rebuildCatalog();
    this.ctx.log.scope("models").info("Model imported from Hugging Face", {
      modelId: entry.id,
      repoId: entry.repoId,
      revision: entry.revision,
    });
    const status = (await this.list()).find(
      (item) => item.entry.id === entry.id,
    );
    if (!status) throw new AppError("INTERNAL", "The imported model was lost.");
    return status;
  }

  /** Forgets an imported model. Its files must be removed first. */
  removeImported(modelId: string): void {
    if (!this.imported.some((entry) => entry.id === modelId)) {
      throw new AppError("NOT_FOUND", "That is not a model you imported.");
    }
    if (this.ctx.db.models.getInstallation(modelId)) {
      throw new AppError(
        "CONFLICT",
        "Remove the model's downloaded files first.",
      );
    }
    this.ctx.db.models.deleteImported(modelId);
    this.imported = this.imported.filter((entry) => entry.id !== modelId);
    this.rebuildCatalog();
  }

  // ------------------------------------------------------------ storage

  modelsRoot(): string {
    return (
      getSettings(this.ctx).modelsDirectory ??
      join(this.ctx.paths.dataDir, "models")
    );
  }

  async storage(): Promise<StorageReport> {
    const root = this.modelsRoot();
    const cache = huggingFaceCachePath(this.ctx.env);
    let managedBytes = 0;
    let partialBytes = 0;
    for (const installation of this.ctx.db.models.listInstallations()) {
      const entry = this.catalog.get(installation.modelId);
      if (installation.state === "installed") {
        managedBytes += installation.bytesTotal;
      } else if (entry) {
        const onDisk = await bytesOnDisk(installation.directory, entry.files);
        partialBytes += onDisk.complete + onDisk.partial;
      }
    }
    return {
      modelsRoot: root,
      isDefaultRoot: getSettings(this.ctx).modelsDirectory === null,
      availableBytes: await freeBytes(root),
      managedBytes,
      partialBytes,
      huggingFaceCache: {
        path: cache,
        exists: (await lstat(cache).catch(() => null))?.isDirectory() ?? false,
      },
      // Suggestions only: not checked, so no other application's data is
      // touched until the user adds the folder.
      suggestedFolders: (this.ctx.host.knownModelFolders?.() ?? []).filter(
        (folder) =>
          !this.ctx.db.models
            .listSources()
            .some((source) => source.path === folder.path),
      ),
    };
  }

  /** Changes where new installations go. Existing ones are not moved. */
  async setStorageRoot(path: string | null): Promise<StorageReport> {
    if (this.active || this.waiting.length > 0) {
      throw new AppError(
        "CONFLICT",
        "Wait for the current download to finish first.",
      );
    }
    const resolved = path === null ? null : await validateStorageRoot(path);
    updateSettings(this.ctx, { modelsDirectory: resolved });
    return this.storage();
  }

  // ----------------------------------------------------------- hardware

  async hardware(refresh = false): Promise<HardwareInventory> {
    if (this.hardwareCache && !refresh) return this.hardwareCache;
    const root = this.modelsRoot();
    await mkdir(root, { recursive: true }).catch(() => {});
    this.hardwareCache = await inspectHardware(this.ctx.host, {
      env: this.ctx.env,
      storagePath: root,
    });
    return this.hardwareCache;
  }

  // ------------------------------------------------------------- status

  async list(): Promise<ModelStatus[]> {
    const hardware = await this.hardware();
    const installations = new Map(
      this.ctx.db.models
        .listInstallations()
        .map((entry) => [entry.modelId, entry]),
    );
    const external = this.ctx.db.models.listExternal();
    return Promise.all(
      this.entries().map(async (entry) => {
        const installation = installations.get(entry.id) ?? null;
        const copies = external.filter(
          (model) => model.matchedModelId === entry.id,
        );
        const status = {
          entry,
          downloadSizeBytes: downloadSizeOf(entry),
          installation,
          compatibility: evaluateCompatibility(entry, hardware),
          runnability: await this.runnability(entry, installation, copies),
          external: copies,
        };
        return { ...status, gallery: galleryStatusOf(status) };
      }),
    );
  }

  /**
   * Asks every adapter that loads model files whether it can run this model.
   * Runnable means: installed (or found externally), and accepted by an
   * adapter that is available right now. For a model that is not on disk,
   * the adapters are asked about the installation it would have, so the
   * interface can say before a download whether it would be usable.
   */
  private async runnability(
    entry: CatalogEntry,
    installation: ModelInstallation | null,
    external: readonly ExternalModel[],
  ): Promise<ModelRunnability> {
    const candidates: ModelCandidate[] = [];
    if (
      installation?.state === "installed" &&
      installation.verification === "verified"
    ) {
      candidates.push(
        this.candidate(entry, "managed", installation.directory, true),
      );
    }
    for (const copy of external) {
      candidates.push(this.candidate(entry, "external", copy.path, false));
    }
    const present = candidates.length > 0;
    if (!present) {
      candidates.push(
        this.candidate(
          entry,
          "managed",
          installation?.directory ?? this.modelsRoot(),
          true,
        ),
      );
    }

    const evaluators: ModelEvaluator[] = [
      ...this.options.registry
        .list()
        .filter(
          (
            adapter,
          ): adapter is AnyAdapter &
            Required<Pick<AnyAdapter, "evaluateModel">> =>
            typeof adapter.evaluateModel === "function",
        ),
      // Engines outside the registry answer only for their own kind of model.
      ...(this.options.evaluators ?? []).filter(
        (evaluator) => evaluator.task === TASK_OF_MODEL[entry.task],
      ),
    ]
      // Engines for the model's own task first, so the explanation shown for
      // a speech model comes from a speech engine.
      .sort(
        (a, b) =>
          Number(TASK_OF_MODEL[entry.task] !== a.task) -
          Number(TASK_OF_MODEL[entry.task] !== b.task),
      );
    const adapters: ModelRunnability["adapters"] = [];
    const seen = new Set<string>();
    for (const adapter of evaluators) {
      if (seen.has(adapter.id)) continue;
      seen.add(adapter.id);
      let usable = false;
      let reason = "";
      let kind: "usable" | "runtime-missing" | "unsupported" = "unsupported";
      for (const candidate of candidates) {
        const evaluation = await adapter.evaluateModel(candidate);
        if (evaluation.usable) {
          usable = true;
          kind = "usable";
          reason = evaluation.reason;
          break;
        }
        // The most hopeful answer wins: "set up the runtime" over "never".
        if (reason === "" || evaluation.kind === "runtime-missing") {
          reason = evaluation.reason;
          kind = evaluation.kind ?? "unsupported";
        }
      }
      adapters.push({
        adapterId: adapter.id,
        adapterName: adapter.name,
        usable,
        kind,
        reason,
      });
    }
    const usableNames = adapters
      .filter((adapter) => adapter.usable)
      .map((adapter) => adapter.adapterName)
      .join(", ");
    const noEngine =
      adapters.length === 0
        ? `no engine in this build runs ${entry.runtime.name} models.`
        : "no available engine can run it.";

    if (!present) {
      return {
        runnable: false,
        reason: usableNames
          ? `Not installed. Once it is, it can run with ${usableNames}.`
          : `Not installed, and ${noEngine}`,
        adapters,
      };
    }
    return {
      runnable: usableNames.length > 0,
      reason: usableNames
        ? `Can be run with ${usableNames}.`
        : noEngine.charAt(0).toUpperCase() + noEngine.slice(1),
      adapters,
    };
  }

  /**
   * Everything one generation engine could be given as its model: what the
   * engine offers itself, verified installations, files in folders the user
   * added, and catalog models still to download. Entries the engine cannot
   * use are included with the reason, rather than left out.
   */
  async choices(
    task: "image_generation" | "video_generation" | "audio_generation",
    adapterId: string,
  ): Promise<ModelChoice[]> {
    const adapter = this.options.registry.get(task, adapterId);
    if (!adapter) {
      throw new AppError(
        "NOT_FOUND",
        "That engine cannot do this kind of work.",
      );
    }
    const capabilities = await adapter.getCapabilities();
    const choices: ModelChoice[] = capabilities.models.map((model) => ({
      key: `engine:${model.id}`,
      kind: "engine",
      name: model.name,
      detail: `Offered by ${adapter.name}`,
      usable: true,
      reason: `${adapter.name} offers this model itself.`,
      reference: model.id,
      modelId: null,
      sizeBytes: null,
      installationState: null,
      presets: [],
    }));
    const presetsOf = (entry: CatalogEntry) =>
      entry.presets.filter(
        (preset) => preset.adapterId === adapter.id && preset.task === task,
      );
    const evaluate = adapter.evaluateModel?.bind(adapter);
    if (!evaluate) return choices;

    const installations = new Map(
      this.ctx.db.models
        .listInstallations()
        .map((installation) => [installation.modelId, installation]),
    );
    for (const entry of this.entries()) {
      const installation = installations.get(entry.id) ?? null;
      const installed =
        installation?.state === "installed" &&
        installation.verification === "verified";
      const evaluation = await evaluate(
        this.candidate(
          entry,
          "managed",
          installation?.directory ?? this.modelsRoot(),
          true,
        ),
      );
      const size = downloadSizeOf(entry);
      const format = entry.format.toUpperCase();
      choices.push(
        installed
          ? {
              key: `installed:${entry.id}`,
              kind: "installed",
              name: entry.name,
              detail: `${format} · ${formatBytes(size)} · installed by Framebop`,
              usable: evaluation.usable,
              reason: evaluation.reason,
              reference: evaluation.usable
                ? (evaluation.reference ?? installation.directory)
                : null,
              modelId: entry.id,
              sizeBytes: size,
              installationState: installation.state,
              presets: presetsOf(entry),
            }
          : {
              key: `download:${entry.id}`,
              kind: "download",
              name: entry.name,
              detail: `${format} · ${formatBytes(size)} · from Hugging Face`,
              usable: evaluation.usable,
              reason: evaluation.usable
                ? `Download it to use it with ${adapter.name}.`
                : evaluation.reason,
              reference: null,
              modelId: entry.id,
              sizeBytes: size,
              installationState: installation?.state ?? null,
              presets: presetsOf(entry),
            },
      );
    }

    const labels = new Map(
      this.ctx.db.models.listSources().map((source) => [source.id, source]),
    );
    for (const model of this.ctx.db.models.listExternal()) {
      const entry = model.matchedModelId
        ? (this.catalog.get(model.matchedModelId) ?? null)
        : null;
      const evaluation = await evaluate({
        modelId: entry?.id ?? null,
        name: model.name,
        family: entry?.family ?? null,
        format: model.format,
        runtime: entry?.runtime.id ?? null,
        task: entry?.task ?? null,
        location: { ownership: "external", path: model.path },
        verified: false,
      });
      choices.push({
        key: `external:${model.id}`,
        kind: "external",
        name: model.name,
        detail: `${model.format.toUpperCase()} · ${formatBytes(model.sizeBytes)} · ${labels.get(model.sourceId)?.label ?? "added folder"}`,
        usable: evaluation.usable,
        reason: evaluation.reason,
        reference: evaluation.usable
          ? (evaluation.reference ?? model.path)
          : null,
        modelId: entry?.id ?? null,
        sizeBytes: model.sizeBytes,
        installationState: null,
        presets: entry ? presetsOf(entry) : [],
      });
    }
    return choices;
  }

  /**
   * Which file does what in the verified installation at `directory`, with
   * shared parts taken from the models that provide them. A part whose
   * model is not installed has no path. Null for any other folder.
   */
  partsOf(directory: string): ResolvedModelParts | null {
    const installed = (installation: ModelInstallation | null) =>
      installation?.state === "installed" &&
      installation.verification === "verified"
        ? installation
        : null;
    const installation = installed(
      this.ctx.db.models
        .listInstallations()
        .find((item) => item.directory === directory) ?? null,
    );
    const entry = installation
      ? (this.catalog.get(installation.modelId) ?? null)
      : null;
    if (!installation || !entry) return null;
    const weights = (of: CatalogEntry) =>
      of.files.find((file) => /\.(gguf|safetensors|ckpt)$/i.test(file.path))
        ?.path ?? null;
    const own = weights(entry);
    const parts: ModelPart[] =
      entry.parts.length > 0
        ? entry.parts
        : own
          ? [{ role: "model", file: own }]
          : [];
    return {
      modelId: entry.id,
      parts: parts.map((part) => {
        if (part.file !== undefined) {
          return {
            role: part.role,
            path: pathInInstallation(installation.directory, part.file),
            missing: null,
          };
        }
        const provider = this.catalog.get(part.model ?? "") ?? null;
        const providerInstallation = installed(
          this.ctx.db.models.getInstallation(part.model ?? ""),
        );
        const file = provider ? weights(provider) : null;
        const path =
          providerInstallation && file
            ? pathInInstallation(providerInstallation.directory, file)
            : null;
        return {
          role: part.role,
          path,
          missing: path === null ? (provider?.name ?? part.model ?? "") : null,
        };
      }),
    };
  }

  /**
   * Whether `model` is what the picker offers for one of this engine's usable
   * entries. A job may name a file by path only when it was offered this way.
   */
  async isOfferedReference(
    task: "image_generation" | "video_generation" | "audio_generation",
    adapterId: string,
    model: string,
  ): Promise<boolean> {
    const choices = await this.choices(task, adapterId);
    return choices.some(
      (choice) =>
        choice.usable &&
        choice.kind !== "download" &&
        choice.reference === model,
    );
  }

  private candidate(
    entry: CatalogEntry,
    ownership: "managed" | "external",
    path: string,
    verified: boolean,
  ): ModelCandidate {
    return {
      modelId: entry.id,
      name: entry.name,
      family: entry.family,
      format: entry.format,
      runtime: entry.runtime.id,
      task: entry.task,
      location: { ownership, path },
      verified,
    };
  }

  // ---------------------------------------------------------- downloads

  private requireEntry(modelId: string): CatalogEntry {
    const entry = this.catalog.get(modelId);
    if (!entry)
      throw new AppError("NOT_FOUND", "That model is not in the catalog.");
    return entry;
  }

  private emit(installation: ModelInstallation | null): void {
    if (installation) this.ctx.emit({ type: "model.updated", installation });
  }

  private update(
    id: string,
    modelId: string,
    changes: Parameters<EngineContext["db"]["models"]["updateInstallation"]>[1],
  ): ModelInstallation | null {
    this.ctx.db.models.updateInstallation(id, changes, this.ctx.now());
    const current = this.ctx.db.models.getInstallation(modelId);
    this.emit(current);
    return current;
  }

  private async ensureSpace(
    directory: string,
    entry: CatalogEntry,
  ): Promise<void> {
    const onDisk = await bytesOnDisk(directory, entry.files);
    const remaining = downloadSizeOf(entry) - onDisk.complete - onDisk.partial;
    const available = await freeBytes(directory);
    if (available !== null && available < remaining + FREE_SPACE_MARGIN) {
      throw new AppError(
        "VALIDATION",
        `Not enough free disk space: ${gigabytes(remaining)} still to download plus ${gigabytes(FREE_SPACE_MARGIN)} to spare, but only ${gigabytes(available)} is free.`,
      );
    }
  }

  /**
   * Queues a download. Called only from an explicit user action; `approved`
   * in the request records that the size, files and licence were shown.
   */
  async install(modelId: string): Promise<ModelInstallation> {
    const entry = this.requireEntry(modelId);
    // Shared parts another model provides are installed with this one.
    for (const part of entry.parts) {
      if (part.model === undefined) continue;
      if (part.model === modelId) continue;
      if (!this.ctx.db.models.getInstallation(part.model)) {
        await this.install(part.model);
      }
    }
    if (entry.access.gated) {
      throw new AppError(
        "UNSUPPORTED",
        `${entry.name} requires accepting its terms and signing in to Hugging Face. Signing in is not supported yet, because access tokens cannot be stored securely in this version.`,
      );
    }
    const existing = this.ctx.db.models.getInstallation(modelId);
    if (existing) {
      if (existing.state === "installed") {
        throw new AppError("CONFLICT", `${entry.name} is already installed.`);
      }
      if (isActiveInstallation(existing)) {
        throw new AppError(
          "CONFLICT",
          `${entry.name} is already being downloaded.`,
        );
      }
      return this.retry(modelId);
    }

    const root = this.modelsRoot();
    await mkdir(root, { recursive: true });
    const storageRoot = await realpath(root);
    const id = randomUUID();
    const directory = join(storageRoot, id);
    await this.ensureSpace(directory, entry);

    const now = this.ctx.now();
    const installation: ModelInstallation = {
      id,
      modelId,
      revision: entry.revision,
      state: "queued",
      storageRoot,
      directory,
      bytesTotal: downloadSizeOf(entry),
      bytesDone: 0,
      currentFile: null,
      verification: "pending",
      error: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
    };
    this.ctx.db.models.insertInstallation(installation);
    this.ctx.log.scope("models").info("Download queued", {
      modelId,
      bytes: installation.bytesTotal,
    });
    this.emit(installation);
    this.waiting.push(modelId);
    this.pump();
    return this.ctx.db.models.getInstallation(modelId) ?? installation;
  }

  /** Resumes a failed or interrupted download; restarts a cancelled one. */
  async retry(modelId: string): Promise<ModelInstallation> {
    const entry = this.requireEntry(modelId);
    const existing = this.ctx.db.models.getInstallation(modelId);
    if (!existing)
      throw new AppError(
        "NOT_FOUND",
        `${entry.name} has no download to retry.`,
      );
    if (!["failed", "interrupted", "cancelled"].includes(existing.state)) {
      throw new AppError(
        "CONFLICT",
        "Only a failed, interrupted or cancelled download can be retried.",
      );
    }
    await this.ensureSpace(existing.directory, entry);
    const queued = this.update(existing.id, modelId, {
      state: "queued",
      error: null,
      currentFile: null,
      verification: "pending",
    });
    this.waiting.push(modelId);
    this.pump();
    return queued ?? existing;
  }

  /** Stops a download and deletes what it had fetched. */
  async cancel(modelId: string): Promise<ModelInstallation> {
    const entry = this.requireEntry(modelId);
    const existing = this.ctx.db.models.getInstallation(modelId);
    if (!existing || !isActiveInstallation(existing)) {
      throw new AppError("CONFLICT", "That model is not being downloaded.");
    }
    if (this.active?.modelId === modelId) {
      this.active.cancelled = true;
      this.active.abort.abort();
      await this.active.done;
    } else {
      this.waiting.splice(this.waiting.indexOf(modelId), 1);
      await this.discardFiles(existing, entry);
      this.update(existing.id, modelId, {
        state: "cancelled",
        bytesDone: 0,
        currentFile: null,
        error: null,
      });
    }
    return this.ctx.db.models.getInstallation(modelId) ?? existing;
  }

  private async discardFiles(
    installation: ModelInstallation,
    entry: CatalogEntry,
  ) {
    await removeInstallationFiles({
      storageRoot: installation.storageRoot,
      directory: installation.directory,
      installationId: installation.id,
      files: entry.files,
    });
  }

  private pump(): void {
    if (this.active || this.stopping) return;
    const modelId = this.waiting.shift();
    if (!modelId) {
      for (const resolve of this.idleWaiters.splice(0)) resolve();
      return;
    }
    const abort = new AbortController();
    const active: ActiveDownload = {
      modelId,
      abort,
      cancelled: false,
      done: Promise.resolve(),
    };
    this.active = active;
    active.done = this.download(modelId, active).finally(() => {
      this.active = null;
      this.pump();
    });
  }

  private async download(
    modelId: string,
    active: ActiveDownload,
  ): Promise<void> {
    const entry = this.requireEntry(modelId);
    const installation = this.ctx.db.models.getInstallation(modelId);
    if (!installation) return;
    const { id } = installation;
    const log = this.ctx.log.scope("models");
    this.update(id, modelId, {
      state: "downloading",
      startedAt: this.ctx.now(),
      error: null,
    });

    try {
      // Confirm the pinned commit still has exactly these files before
      // spending any bandwidth on them.
      // Each repository a file comes from is checked at its own commit.
      const sources = new Map<string, ModelFile[]>();
      for (const file of entry.files) {
        const key = `${file.repoId ?? entry.repoId}@${file.revision ?? entry.revision}`;
        sources.set(key, [...(sources.get(key) ?? []), file]);
      }
      for (const [key, files] of sources) {
        const [repoId = "", revision = ""] = key.split("@");
        const remote = await this.options.hub.revision(
          repoId,
          revision,
          active.abort.signal,
        );
        checkAgainstRevision(files, remote, revision);
      }
      await mkdir(installation.directory, { recursive: true });

      let completed = 0;
      for (const file of entry.files) {
        await this.ensureSpace(installation.directory, entry);
        this.update(id, modelId, {
          currentFile: file.path,
          bytesDone: completed,
        });
        const finalPath = pathInInstallation(installation.directory, file.path);
        let lastPublished = 0;
        await downloadVerifiedFile({
          url: this.options.hub.fileUrl(
            file.repoId ?? entry.repoId,
            file.revision ?? entry.revision,
            file.path,
          ),
          file,
          finalPath,
          partialPath: partialPathOf(finalPath),
          signal: active.abort.signal,
          fetchImpl: this.options.fetchImpl,
          onTransfer: (offset) => {
            if (offset > 0) {
              log.info("Download continued with a range request", {
                modelId,
                file: file.path,
                offset,
              });
            }
          },
          onBytes: (bytes) => {
            const now = Date.now();
            if (
              now - lastPublished < PROGRESS_INTERVAL_MS &&
              bytes !== file.sizeBytes
            )
              return;
            lastPublished = now;
            this.update(id, modelId, { bytesDone: completed + bytes });
          },
        });
        completed += file.sizeBytes;
      }

      this.update(id, modelId, {
        state: "verifying",
        bytesDone: completed,
        currentFile: null,
      });
      // Every file was hashed as it arrived; the marker records ownership
      // and the manifest that removal will be limited to.
      await writeMarker(installation.directory, {
        format: "framebop.model-installation",
        installationId: id,
        modelId,
        repoId: entry.repoId,
        revision: entry.revision,
        files: entry.files.map((file) => ({
          path: file.path,
          sizeBytes: file.sizeBytes,
        })),
        installedAt: this.ctx.now(),
      });
      this.update(id, modelId, {
        state: "installed",
        verification: "verified",
        completedAt: this.ctx.now(),
      });
      log.info("Model installed and verified", { modelId, bytes: completed });
    } catch (error) {
      if (active.cancelled) {
        await this.discardFiles(installation, entry).catch(() => {});
        this.update(id, modelId, {
          state: "cancelled",
          bytesDone: 0,
          currentFile: null,
          error: null,
        });
        log.info("Download cancelled; partial files deleted", { modelId });
        return;
      }
      const onDisk = await bytesOnDisk(
        installation.directory,
        entry.files,
      ).catch(() => null);
      const kept = onDisk ? onDisk.complete + onDisk.partial : 0;
      if (this.stopping) {
        this.update(id, modelId, {
          state: "interrupted",
          bytesDone: kept,
          currentFile: null,
          error: {
            code: "INTERRUPTED",
            message:
              "The application closed during the download. Resume to continue where it stopped.",
          },
        });
        return;
      }
      const shape = toErrorShape(error);
      this.update(id, modelId, {
        state: "failed",
        bytesDone: kept,
        currentFile: null,
        verification: shape.code === "INTEGRITY" ? "failed" : "pending",
        error: { code: shape.code, message: shape.message },
      });
      log.error("Download failed", {
        modelId,
        code: shape.code,
        reason: shape.message,
      });
    }
  }

  /** Hashes the installed files again against their published values. */
  async verify(modelId: string): Promise<ModelInstallation> {
    const entry = this.requireEntry(modelId);
    const installation = this.ctx.db.models.getInstallation(modelId);
    if (!installation || installation.state !== "installed") {
      throw new AppError(
        "CONFLICT",
        "Only an installed model can be verified.",
      );
    }
    const problems: string[] = [];
    for (const file of entry.files) {
      const path = pathInInstallation(installation.directory, file.path);
      const info = await stat(path).catch(() => null);
      if (!info?.isFile() || info.size !== file.sizeBytes) {
        problems.push(`${file.path} is missing or has the wrong size`);
        continue;
      }
      const digest = new FileDigest(file);
      await pipeline(
        createReadStream(path),
        async (source: AsyncIterable<Buffer>) => {
          for await (const chunk of source) digest.update(chunk);
        },
      );
      if (!digest.matches())
        problems.push(`${file.path} does not match its published hash`);
    }
    return (
      this.update(
        installation.id,
        modelId,
        problems.length === 0
          ? { verification: "verified", error: null }
          : {
              state: "failed",
              verification: "failed",
              error: {
                code: "INTEGRITY",
                message: `${problems.join("; ")}. Download it again to replace the affected files.`,
              },
            },
      ) ?? installation
    );
  }

  /** Deletes a managed installation's own files and forgets it. */
  async remove(modelId: string): Promise<void> {
    const entry = this.requireEntry(modelId);
    const users = this.entries().filter(
      (other) =>
        other.id !== modelId &&
        other.parts.some((part) => part.model === modelId) &&
        this.ctx.db.models.getInstallation(other.id) !== null,
    );
    if (users.length > 0) {
      throw new AppError(
        "CONFLICT",
        `${users.map((other) => other.name).join(", ")} ${users.length === 1 ? "uses" : "use"} ${entry.name}. Remove ${users.length === 1 ? "it" : "them"} first.`,
      );
    }
    const installation = this.ctx.db.models.getInstallation(modelId);
    if (!installation) {
      const external = this.ctx.db.models
        .listExternal()
        .some((model) => model.matchedModelId === modelId);
      throw new AppError(
        "NOT_FOUND",
        external
          ? `${entry.name} was not installed by Framebop Studio. Copies found elsewhere are external and are never deleted.`
          : `${entry.name} is not installed.`,
      );
    }
    if (isActiveInstallation(installation)) {
      throw new AppError(
        "CONFLICT",
        "Cancel the download before removing the model.",
      );
    }
    const report = await removeInstallationFiles({
      storageRoot: installation.storageRoot,
      directory: installation.directory,
      installationId: installation.id,
      files: entry.files,
    });
    this.ctx.db.models.deleteInstallation(installation.id);
    this.ctx.emit({ type: "model.removed", modelId });
    this.ctx.log.scope("models").info("Model removed", {
      modelId,
      removedFiles: report.removedFiles,
      leftBehind: report.leftBehind,
    });
  }

  // ------------------------------------------------------ external models

  sources(): ModelSource[] {
    return this.ctx.db.models.listSources();
  }

  async addSource(
    kind: ModelSource["kind"],
    path: string,
  ): Promise<ModelSource> {
    if (!isAbsolute(path))
      throw new AppError("VALIDATION", "Choose a folder by its full path.");
    const info = await stat(path).catch(() => null);
    if (!info?.isDirectory())
      throw new AppError("NOT_FOUND", "That folder does not exist.");
    const resolved = await realpath(path);
    // Managed storage is not an external source; listing it as one would
    // blur exactly the distinction this feature exists to keep.
    const managed = await realpath(this.modelsRoot()).catch(() => null);
    const within = (parent: string, child: string) => {
      const path = relative(parent, child);
      return !path.startsWith("..") && !isAbsolute(path);
    };
    if (managed && (within(managed, resolved) || within(resolved, managed))) {
      throw new AppError(
        "VALIDATION",
        "That folder is, or contains, Framebop's own model storage. Choose a folder outside it.",
      );
    }
    if (this.sources().some((source) => source.path === resolved)) {
      throw new AppError("CONFLICT", "That folder is already being watched.");
    }
    const source: ModelSource = {
      id: randomUUID(),
      kind,
      path: resolved,
      label:
        kind === "huggingface-cache"
          ? "Hugging Face cache"
          : basename(resolved),
      addedAt: this.ctx.now(),
      lastScannedAt: null,
      lastError: null,
    };
    this.ctx.db.models.insertSource(source);
    await this.scanSource(source);
    return this.ctx.db.models.getSource(source.id) ?? source;
  }

  /** Forgets a source. The folder and its files are not touched. */
  removeSource(id: string): void {
    if (!this.ctx.db.models.deleteSource(id)) {
      throw new AppError("NOT_FOUND", "That source no longer exists.");
    }
  }

  private async scanSource(source: ModelSource): Promise<void> {
    const now = this.ctx.now();
    try {
      const found =
        source.kind === "huggingface-cache"
          ? await scanHuggingFaceCache(source.path, this.entries())
          : await scanModelFolder(source.path, this.entries());
      this.ctx.db.models.replaceExternal(
        source.id,
        found.map((model) => ({
          ...model,
          id: randomUUID(),
          sourceId: source.id,
          discoveredAt: now,
        })),
        now,
        null,
      );
    } catch (error) {
      this.ctx.db.models.replaceExternal(
        source.id,
        [],
        now,
        toErrorShape(error).message,
      );
    }
  }

  async scanAll(): Promise<ExternalModel[]> {
    for (const source of this.sources()) await this.scanSource(source);
    return this.ctx.db.models.listExternal();
  }

  external(): ExternalModel[] {
    return this.ctx.db.models.listExternal();
  }

  // ------------------------------------------------------------ lifecycle

  /** Resolves once no download is running or waiting. */
  idle(): Promise<void> {
    if (!this.active && this.waiting.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  /** Stops downloading, keeping partial files so a retry can resume. */
  async shutdown(): Promise<void> {
    this.stopping = true;
    this.waiting.splice(0);
    if (this.active) {
      this.active.abort.abort();
      await this.active.done;
    }
    // Anything still marked as queued did not start; record it as interrupted.
    this.ctx.db.models.markActiveAsInterrupted(this.ctx.now());
  }
}
