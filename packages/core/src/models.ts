/**
 * Types shared by the model manager and the interface.
 *
 * Three questions are kept strictly apart, because they have different
 * answers and mixing them up is how model managers mislead people:
 *
 *   installed   the files are on disk and their hashes match the source
 *   compatible  the model's stated requirements are met by this machine
 *   runnable    an engine in this build can actually load and run it
 *
 * A model can be installed and compatible and still not runnable, which is
 * the normal case until an engine for it exists.
 */
import { z } from "zod";

const Timestamp = z.string();
const CommitHash = z
  .string()
  .regex(/^[0-9a-f]{40}$/, "Expected a full 40-character commit hash");

// ---------------------------------------------------------------- hardware

export const AcceleratorSchema = z.enum(["cpu", "apple-metal", "cuda", "rocm"]);
export type Accelerator = z.infer<typeof AcceleratorSchema>;

export const GpuSchema = z.object({
  name: z.string().nullable(),
  vendor: z.string().nullable(),
  /** Compute interface the GPU is reached through, when known. */
  backend: z.enum(["metal", "cuda", "rocm"]).nullable(),
  memory: z.object({
    /**
     * unified - shares system memory (Apple Silicon); there is no separate
     *           VRAM figure, and none is invented
     * dedicated - its own memory, with a size reported by the driver
     * unknown - the platform did not report it reliably
     */
    kind: z.enum(["unified", "dedicated", "unknown"]),
    bytes: z.number().nonnegative().nullable(),
    note: z.string().nullable(),
  }),
  /** The command or API the values came from. */
  source: z.string(),
});
export type Gpu = z.infer<typeof GpuSchema>;

export const RuntimeStatusSchema = z.object({
  id: AcceleratorSchema,
  name: z.string(),
  available: z.boolean(),
  version: z.string().nullable(),
  detail: z.string(),
});
export type RuntimeStatus = z.infer<typeof RuntimeStatusSchema>;

export const HardwareInventorySchema = z.object({
  os: z.enum(["macos", "windows", "linux", "unknown"]),
  /** The macOS product version, or the kernel release on Windows and Linux. */
  osVersion: z.string().nullable(),
  arch: z.string(),
  cpu: z.object({ model: z.string(), cores: z.number().int() }),
  memory: z.object({ totalBytes: z.number().nonnegative() }),
  gpus: z.array(GpuSchema),
  storage: z.object({
    path: z.string(),
    availableBytes: z.number().nonnegative().nullable(),
    totalBytes: z.number().nonnegative().nullable(),
  }),
  /** Compute back ends usable on this machine. CPU is always present. */
  runtimes: z.array(RuntimeStatusSchema),
  /** Each value that could not be determined, and why. */
  unavailable: z.array(z.object({ field: z.string(), reason: z.string() })),
  detectedAt: Timestamp,
});
export type HardwareInventory = z.infer<typeof HardwareInventorySchema>;

// ----------------------------------------------------------------- catalog

export const ModelTaskSchema = z.enum([
  "image",
  "video",
  "image_to_video",
  "audio",
  /** Language models, run by the local llama.cpp runtime. */
  "text",
  "other",
]);
export type ModelTask = z.infer<typeof ModelTaskSchema>;

export const ModelFileSchema = z
  .object({
    /** Path inside the repository, forward-slashed. */
    path: z
      .string()
      .min(1)
      .max(300)
      .refine(
        (path) =>
          !path.startsWith("/") &&
          !path.includes("\\") &&
          !path
            .split("/")
            .some((part) => part === ".." || part === "." || part === ""),
        "Must be a plain relative path",
      ),
    sizeBytes: z.number().int().positive(),
    /** SHA-256 of the content: the Git LFS object id. */
    sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .nullable(),
    /** Git blob id (SHA-1 of the blob), for small files not stored in LFS. */
    gitBlobId: z
      .string()
      .regex(/^[0-9a-f]{40}$/)
      .nullable(),
    /**
     * Another repository the file comes from, at its own commit. Left out:
     * the entry's repository. Lets one model gather parts published apart.
     */
    repoId: z
      .string()
      .regex(/^[\w.-]+\/[\w.-]+$/)
      .optional(),
    revision: CommitHash.optional(),
  })
  .refine(
    (file) => file.sha256 !== null || file.gitBlobId !== null,
    "Every file needs a hash to verify it against",
  )
  .refine(
    (file) => (file.repoId === undefined) === (file.revision === undefined),
    "A file from another repository needs that repository's commit",
  );
export type ModelFile = z.infer<typeof ModelFileSchema>;

/**
 * What a file does when the model runs, named after the stable-diffusion.cpp
 * option it is passed with: "model" is a complete checkpoint, the others
 * are parts of a model published as separate files.
 */
export const MODEL_PART_ROLES = [
  "model",
  "diffusion-model",
  "high-noise-diffusion-model",
  "vae",
  "t5xxl",
  "llm",
  "clip_l",
  "clip_g",
  "clip_vision",
] as const;
export const ModelPartSchema = z
  .object({
    role: z.enum(MODEL_PART_ROLES),
    /** One of this entry's files... */
    file: z.string().optional(),
    /** ...or another catalog model, installed alongside and shared. */
    model: z.string().optional(),
  })
  .refine(
    (part) => (part.file === undefined) !== (part.model === undefined),
    "A part is either one of the entry's files or another model",
  );
export type ModelPart = z.infer<typeof ModelPartSchema>;

/**
 * What a model generates, as the gallery groups it. A model may do several
 * things; only those an engine in this build can drive are offered as such.
 */
export const GENERATION_CATEGORIES = [
  "text-to-image",
  "image-to-image",
  "text-to-video",
  "image-to-video",
  "text-to-speech",
  "audio",
  /**
   * Language models. Listed so they can be found and managed; no engine in
   * this build runs them (a local llama.cpp engine is planned for Phase 5A.2).
   */
  "text-generation",
  "other",
] as const;
export const GenerationCategorySchema = z.enum(GENERATION_CATEGORIES);
export type GenerationCategory = z.infer<typeof GenerationCategorySchema>;

const PresetValue = z.union([z.number(), z.string(), z.boolean()]);

/**
 * Settings for one engine and one task with one model. Parameters use the
 * engine's own setting names; anything the engine does not offer is
 * reported when the preset is applied, never silently dropped.
 */
export const ModelPresetSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/),
  kind: z.enum(["fast-preview", "balanced", "quality", "custom"]),
  label: z.string().min(1).max(60),
  description: z.string().max(300),
  adapterId: z.string(),
  task: z.enum(["image_generation", "video_generation", "audio_generation"]),
  parameters: z.record(z.string(), PresetValue),
  /** Output size, only for engines that take one. */
  size: z
    .object({ width: z.number().int(), height: z.number().int() })
    .nullable()
    .default(null),
  /** True only when results with these settings were actually checked. */
  verified: z.boolean(),
  note: z.string().nullable().default(null),
});
export type ModelPreset = z.infer<typeof ModelPresetSchema>;

/** A recorded run of the model on real hardware, by the maintainers. */
export const InferenceTestSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  os: z.enum(["macos", "windows", "linux"]),
  arch: z.string(),
  hardware: z.string(),
  adapterId: z.string(),
  result: z.enum(["works", "fails"]),
  detail: z.string(),
});
export type InferenceTest = z.infer<typeof InferenceTestSchema>;

export const CatalogEntrySchema = z
  .object({
    /** Stable identifier, never reused for a different model. */
    id: z.string().regex(/^[a-z0-9][a-z0-9.-]{2,79}$/),
    name: z.string().min(1),
    description: z.string(),
    source: z.literal("huggingface"),
    repoId: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
    /** The exact commit the file list and hashes were taken from. */
    revision: CommitHash,
    family: z.string(),
    task: ModelTaskSchema,
    variant: z.string(),
    quantization: z.string().nullable(),
    format: z.enum(["onnx", "safetensors", "pytorch", "gguf"]),
    /** Only the files needed to run this variant, not the whole repository. */
    files: z.array(ModelFileSchema).min(1),
    runtime: z.object({
      id: z.string(),
      name: z.string(),
    }),
    hardware: z.object({
      /**
       * Compute back ends the runtime supports for this model. Null when the
       * publisher does not say, in which case compatibility is "unknown".
       */
      accelerators: z.array(AcceleratorSchema).nullable(),
      /** Only set when the publisher states a figure. Never estimated. */
      minimumMemoryBytes: z.number().int().positive().nullable(),
      /** Where the requirements above come from. */
      source: z.string().url().nullable(),
      notes: z.array(z.string()),
    }),
    license: z.object({
      /** SPDX identifier, or "other" for custom licences. */
      id: z.string(),
      name: z.string(),
      url: z.string().url(),
      summary: z.string(),
    }),
    access: z.object({
      gated: z.boolean(),
      requirements: z.string().nullable(),
    }),
    pageUrl: z.string().url(),
    /** When the repository metadata was last checked against the hub. */
    verifiedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    /** Who publishes the weights, as shown on the hub. */
    provider: z.string().default(""),
    /** Entries that are variants of one model share a group. */
    group: z.string().nullable().default(null),
    categories: z.array(GenerationCategorySchema).default([]),
    /** Operating systems the runtime supports. Null when not stated. */
    platforms: z
      .array(z.enum(["macos", "windows", "linux"]))
      .nullable()
      .default(null),
    presets: z.array(ModelPresetSchema).default([]),
    /**
     * Which file does what. Empty: the model is its one weights file. Other
     * models named here are installed with this one.
     */
    parts: z.array(ModelPartSchema).default([]),
    inferenceTests: z.array(InferenceTestSchema).default([]),
    /**
     * registry - from the Framebop registry, reviewed by its maintainers
     * imported - added by the user from Hugging Face, not reviewed
     */
    origin: z.enum(["registry", "imported"]).default("registry"),
    /**
     * For language models: how the local runtime runs them. The chat
     * template is one of llama.cpp's built-in ones, chosen when the entry was
     * reviewed, so the template inside the model file is never used.
     */
    llm: z
      .object({
        chatTemplate: z.string().regex(/^[a-z0-9][a-z0-9.-]{0,40}$/),
        contextTokens: z.number().int().min(512).max(131_072),
        /**
         * Whether the model was found able to write long scripts (several
         * minutes of coherent narration). Only set after real testing.
         */
        longForm: z.boolean().default(false),
      })
      .nullable()
      .default(null),
  })
  .refine(
    (entry) =>
      new Set(entry.files.map((file) => file.path)).size === entry.files.length,
    "A file is listed twice",
  )
  .refine(
    (entry) =>
      entry.parts.every(
        (part) =>
          part.file === undefined ||
          entry.files.some((file) => file.path === part.file),
      ),
    "A part names a file the entry does not list",
  );
export type CatalogEntry = z.infer<typeof CatalogEntrySchema>;

export function downloadSizeOf(entry: Pick<CatalogEntry, "files">): number {
  return entry.files.reduce((total, file) => total + file.sizeBytes, 0);
}

// ------------------------------------------------------------ installation

export const InstallationStateSchema = z.enum([
  "queued",
  "downloading",
  "verifying",
  "installed",
  "failed",
  "cancelled",
  "interrupted",
]);
export type InstallationState = z.infer<typeof InstallationStateSchema>;

export const ModelInstallationSchema = z.object({
  id: z.string(),
  modelId: z.string(),
  revision: CommitHash,
  state: InstallationStateSchema,
  /** The managed storage folder the model was installed under. */
  storageRoot: z.string(),
  /** Absolute path of the model's own folder. */
  directory: z.string(),
  bytesTotal: z.number().int().nonnegative(),
  /** Bytes received and verified so far. Counted, never estimated. */
  bytesDone: z.number().int().nonnegative(),
  currentFile: z.string().nullable(),
  verification: z.enum(["pending", "verified", "failed"]),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  startedAt: Timestamp.nullable(),
  completedAt: Timestamp.nullable(),
});
export type ModelInstallation = z.infer<typeof ModelInstallationSchema>;

export const isActiveInstallation = (
  installation: Pick<ModelInstallation, "state">,
) =>
  installation.state === "queued" ||
  installation.state === "downloading" ||
  installation.state === "verifying";

// ---------------------------------------------------------------- external

export const ModelSourceSchema = z.object({
  id: z.string(),
  kind: z.enum(["folder", "huggingface-cache"]),
  path: z.string(),
  label: z.string(),
  addedAt: Timestamp,
  lastScannedAt: Timestamp.nullable(),
  lastError: z.string().nullable(),
});
export type ModelSource = z.infer<typeof ModelSourceSchema>;

/** A model file found outside managed storage. Framebop never changes it. */
export const ExternalModelSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  /** Absolute path of the file, or of the snapshot folder for a cache entry. */
  path: z.string(),
  name: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  format: z.string(),
  /** Set for Hugging Face cache entries. */
  repoId: z.string().nullable(),
  revision: z.string().nullable(),
  /** The catalog entry this matches, when it can be told for certain. */
  matchedModelId: z.string().nullable(),
  discoveredAt: Timestamp,
});
export type ExternalModel = z.infer<typeof ExternalModelSchema>;

// ------------------------------------------------------------------ status

export const CompatibilityCheckSchema = z.object({
  label: z.string(),
  result: z.enum(["pass", "fail", "unknown"]),
  detail: z.string(),
});

export const ModelCompatibilitySchema = z.object({
  status: z.enum(["compatible", "incompatible", "unknown"]),
  checks: z.array(CompatibilityCheckSchema),
});
export type ModelCompatibility = z.infer<typeof ModelCompatibilitySchema>;

export const ModelRunnabilitySchema = z.object({
  runnable: z.boolean(),
  /** The deciding reason, in one sentence. */
  reason: z.string(),
  adapters: z.array(
    z.object({
      adapterId: z.string(),
      adapterName: z.string(),
      usable: z.boolean(),
      /** Why not: its runtime is missing, or it cannot run this model at all. */
      kind: z.enum(["usable", "runtime-missing", "unsupported"]),
      reason: z.string(),
    }),
  ),
});
export type ModelRunnability = z.infer<typeof ModelRunnabilitySchema>;

/**
 * The one status a gallery card shows. Derived, never stored, from the
 * installation, the copies found elsewhere, the engines and the hardware
 * (see `galleryStatusOf`). "ready" requires an engine that can run the
 * model now: files on disk alone never make a model ready.
 */
export const GALLERY_STATUSES = [
  "ready",
  "installed-runtime-missing",
  "external",
  "downloading",
  "verification-failed",
  "compatible",
  "compatibility-unknown",
  "insufficient",
  "unsupported",
] as const;
export const GalleryStatusSchema = z.enum(GALLERY_STATUSES);
export type GalleryStatus = z.infer<typeof GalleryStatusSchema>;

export const GALLERY_STATUS_LABELS: Record<GalleryStatus, string> = {
  ready: "Ready to Use",
  "installed-runtime-missing": "Installed — Runtime Missing",
  external: "External Installation",
  downloading: "Downloading",
  "verification-failed": "Verification Failed",
  compatible: "Compatible — Not Installed",
  "compatibility-unknown": "Compatibility Unknown",
  insufficient: "Insufficient Resources",
  unsupported: "Unsupported",
};

/** Everything the interface needs to show one catalog model. */
export const ModelStatusSchema = z.object({
  entry: CatalogEntrySchema,
  downloadSizeBytes: z.number().int().nonnegative(),
  installation: ModelInstallationSchema.nullable(),
  compatibility: ModelCompatibilitySchema,
  runnability: ModelRunnabilitySchema,
  /** Copies of this model found in external locations. */
  external: z.array(ExternalModelSchema),
  gallery: z.object({ status: GalleryStatusSchema, reason: z.string() }),
});
export type ModelStatus = z.infer<typeof ModelStatusSchema>;

/** Decides a gallery card's status. Pure, so the rules are testable. */
export function galleryStatusOf(
  status: Pick<
    ModelStatus,
    "installation" | "compatibility" | "runnability" | "external"
  >,
): { status: GalleryStatus; reason: string } {
  const { installation, compatibility, runnability, external } = status;
  const engines = runnability.adapters;
  const runtimeMissing = engines.find((a) => a.kind === "runtime-missing");
  const anyEngine = engines.some((a) => a.kind !== "unsupported");

  if (installation && isActiveInstallation(installation)) {
    return { status: "downloading", reason: "Being downloaded now." };
  }
  if (
    installation &&
    (installation.verification === "failed" ||
      installation.error?.code === "INTEGRITY")
  ) {
    return {
      status: "verification-failed",
      reason:
        installation.error?.message ??
        "The files on disk do not match their published hashes.",
    };
  }
  if (runnability.runnable) {
    return { status: "ready", reason: runnability.reason };
  }
  const installed =
    installation?.state === "installed" &&
    installation.verification === "verified";
  if (installed) {
    return {
      status: "installed-runtime-missing",
      reason: runtimeMissing?.reason ?? runnability.reason,
    };
  }
  if (external.length > 0) {
    return {
      status: "external",
      reason: `Found at ${external[0]?.path}. ${runtimeMissing?.reason ?? runnability.reason}`,
    };
  }
  if (!anyEngine) {
    return {
      status: "unsupported",
      reason:
        engines[0]?.reason ??
        "No engine in this version of Framebop Studio can run this model.",
    };
  }
  if (compatibility.status === "incompatible") {
    return {
      status: "insufficient",
      reason:
        compatibility.checks.find((check) => check.result === "fail")?.detail ??
        "This computer does not meet its stated requirements.",
    };
  }
  if (compatibility.status === "compatible") {
    return {
      status: "compatible",
      reason: "This computer meets its stated requirements.",
    };
  }
  return {
    status: "compatibility-unknown",
    reason: "Compatibility unknown — not yet tested.",
  };
}

// ---------------------------------------------------------------- registry

/** Version of the registry file format this build reads. */
export const REGISTRY_SCHEMA_VERSION = 1;

/**
 * The Framebop model registry: a versioned list of reviewed models. A copy
 * ships with the app; a newer one can be fetched on request.
 */
export const RegistryManifestSchema = z
  .object({
    schemaVersion: z.literal(REGISTRY_SCHEMA_VERSION),
    /** Date-based, so versions sort as text: 2026.10.14, 2026.10.14.1 */
    registryVersion: z.string().regex(/^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/),
    publishedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    models: z.array(CatalogEntrySchema),
  })
  .refine(
    (manifest) =>
      new Set(manifest.models.map((entry) => entry.id)).size ===
      manifest.models.length,
    "A model id is listed twice",
  );
export type RegistryManifest = z.infer<typeof RegistryManifestSchema>;

export const RegistryStatusSchema = z.object({
  /** Where the models in use come from. */
  source: z.enum(["bundled", "remote"]),
  registryVersion: z.string(),
  publishedAt: z.string(),
  bundledVersion: z.string(),
  remoteUrl: z.string().nullable(),
  fetchedAt: z.string().nullable(),
  /** Why the last update failed, if it did. The models in use are unaffected. */
  lastError: z.string().nullable(),
  modelCount: z.number().int(),
  importedCount: z.number().int(),
});
export type RegistryStatus = z.infer<typeof RegistryStatusSchema>;

// ------------------------------------------------------------ hugging face

export const HubSearchResultSchema = z.object({
  id: z.string(),
  author: z.string(),
  pipelineTag: z.string().nullable(),
  category: GenerationCategorySchema.nullable(),
  likes: z.number().int().nonnegative(),
  downloads: z.number().int().nonnegative(),
  license: z.string().nullable(),
  gated: z.boolean(),
  tags: z.array(z.string()),
  createdAt: z.string().nullable(),
});
export type HubSearchResult = z.infer<typeof HubSearchResultSchema>;

export const HubSearchPageSchema = z.object({
  results: z.array(HubSearchResultSchema),
  /** Opaque; pass back to get the next page. Null on the last page. */
  nextCursor: z.string().nullable(),
});
export type HubSearchPage = z.infer<typeof HubSearchPageSchema>;

export const HubModelDetailsSchema = z.object({
  id: z.string(),
  author: z.string(),
  /** The commit the details describe. */
  sha: z.string(),
  pipelineTag: z.string().nullable(),
  category: GenerationCategorySchema.nullable(),
  library: z.string().nullable(),
  license: z.string().nullable(),
  licenseName: z.string().nullable(),
  licenseLink: z.string().nullable(),
  gated: z.boolean(),
  downloads: z.number().int().nonnegative(),
  likes: z.number().int().nonnegative(),
  lastModified: z.string().nullable(),
  url: z.string(),
  files: z.array(
    z.object({
      path: z.string(),
      sizeBytes: z.number().int().nonnegative().nullable(),
      sha256: z.string().nullable(),
    }),
  ),
  totalBytes: z.number().int().nonnegative(),
  /**
   * registry   - the Framebop registry already lists this repository
   * importable - an engine in this build can run it; it can be added
   * kit        - its weights can run once the user chooses which file does
   *              what (a diffusion model, its VAE, its text encoders)
   * unsupported - found, but no Framebop runtime can run it
   */
  support: z.object({
    state: z.enum(["registry", "importable", "kit", "unsupported"]),
    reason: z.string(),
    registryIds: z.array(z.string()),
    runtimeId: z.string().nullable(),
    /** What would be downloaded if it were added. */
    selectedFiles: z.array(z.string()),
    selectedBytes: z.number().int().nonnegative(),
    /**
     * For a kit: the weight files to choose from, with the role their
     * folder or name suggests, and a first choice of one file per role.
     */
    candidates: z
      .array(
        z.object({
          path: z.string(),
          sizeBytes: z.number().int().nonnegative(),
          role: z.enum(MODEL_PART_ROLES).nullable(),
          suggested: z.boolean(),
        }),
      )
      .default([]),
    /** For a kit: whether it seems to make pictures or clips. */
    task: z.enum(["image", "image_to_video"]).nullable().default(null),
  }),
});
export type HubModelDetails = z.infer<typeof HubModelDetailsSchema>;

/** The parts a user chose from a kit repository: which file does what. */
export const HubKitSchema = z.strictObject({
  task: z.enum(["image", "image_to_video"]),
  parts: z
    .array(
      z.strictObject({
        role: z.enum(MODEL_PART_ROLES),
        /** A file of the repository... */
        path: z.string().min(1).max(300).optional(),
        /** ...or a model already in the catalog, shared. */
        model: z.string().min(1).max(80).optional(),
      }),
    )
    .min(1)
    .max(8),
});
export type HubKit = z.infer<typeof HubKitSchema>;

/**
 * One entry in the model picker of a generation engine. Every model the
 * engine might be given is listed, including those it cannot use, with the
 * reason, so nothing is silently left out.
 */
export const ModelChoiceSchema = z.object({
  /** Stable within one listing. */
  key: z.string(),
  /**
   * engine    - offered by the engine itself
   * installed - downloaded and verified by Framebop
   * external  - found in a folder the user added; read-only
   * download  - in the catalog, not installed yet
   */
  kind: z.enum(["engine", "installed", "external", "download"]),
  name: z.string(),
  /** Format, size and where it is, in a few words. */
  detail: z.string(),
  /**
   * For engine, installed and external entries: the engine can use it now.
   * For download entries: the engine could use it once it is installed.
   */
  usable: z.boolean(),
  reason: z.string(),
  /** What to send as the job's model when this entry is chosen. */
  reference: z.string().nullable(),
  /** The catalog entry, for installed, download and matched external entries. */
  modelId: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  /** Set while a download entry is being installed. */
  installationState: InstallationStateSchema.nullable(),
  /** The registry's presets for this model, this engine and this task. */
  presets: z.array(ModelPresetSchema).default([]),
});
export type ModelChoice = z.infer<typeof ModelChoiceSchema>;

export const VoiceSchema = z.object({
  id: z.string(),
  name: z.string(),
  language: z.string(),
  languageName: z.string(),
  gender: z.enum(["female", "male"]).nullable(),
  supported: z.boolean(),
  reason: z.string().nullable(),
});
export type Voice = z.infer<typeof VoiceSchema>;

export const StorageReportSchema = z.object({
  /** Where new installations go. */
  modelsRoot: z.string(),
  isDefaultRoot: z.boolean(),
  availableBytes: z.number().nonnegative().nullable(),
  /** Bytes used by completed managed installations. */
  managedBytes: z.number().nonnegative(),
  /** Bytes held by unfinished downloads that can be resumed. */
  partialBytes: z.number().nonnegative(),
  /** Hugging Face's shared cache, if this machine has one. Never written to. */
  huggingFaceCache: z.object({ path: z.string(), exists: z.boolean() }),
  /**
   * Folders other applications usually keep models in on this OS. Not
   * checked or read; offered so the user can add one in a click.
   */
  suggestedFolders: z
    .array(
      z.object({ application: z.string(), path: z.string(), note: z.string() }),
    )
    .default([]),
});
export type StorageReport = z.infer<typeof StorageReportSchema>;

/** A runtime Framebop installs and runs itself (the image engine). */
export const ImageRuntimeStatusSchema = z.object({
  name: z.string(),
  version: z.string(),
  license: z.string(),
  state: z.enum(["not-installed", "installing", "installed", "unsupported"]),
  /** Size of the download, when a build exists for this computer. */
  downloadBytes: z.number().int().nullable(),
  /** Space the installed files take, freed when the runtime is removed. */
  installedBytes: z.number().int().nullable(),
  path: z.string().nullable(),
  installedAt: z.string().nullable(),
});
export type ImageRuntimeStatus = z.infer<typeof ImageRuntimeStatusSchema>;

/** Framebop's voice engine and the voice packs it can install. */
export const VoiceSetupStatusSchema = z.object({
  runtime: ImageRuntimeStatusSchema,
  packs: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      language: z.string(),
      license: z.string(),
      downloadBytes: z.number().int(),
      installedBytes: z.number().int().nullable(),
      state: z.enum(["not-installed", "installing", "installed"]),
    }),
  ),
  /** While something is being downloaded. */
  progress: z
    .object({ bytesDone: z.number().int(), bytesTotal: z.number().int() })
    .nullable(),
  /** Why the last installation failed, until the next one starts. */
  error: z.string().nullable(),
});
export type VoiceSetupStatus = z.infer<typeof VoiceSetupStatusSchema>;
