import { z } from "zod";
import { ASSET_KINDS } from "./media";

export const IdSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    "Expected an id",
  );

const Timestamp = z.string();

// ---------------------------------------------------------------- projects

const projectFields = {
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().max(2000),
  targetDurationSeconds: z
    .number()
    .int()
    .min(5)
    .max(6 * 3600),
  language: z.string().trim().min(2).max(35),
  visualStyle: z.string().max(500),
};

export const ProjectSchema = z.object({
  id: IdSchema,
  ...projectFields,
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type Project = z.infer<typeof ProjectSchema>;

export const ProjectCreateSchema = z.strictObject({
  name: projectFields.name,
  description: projectFields.description.default(""),
  targetDurationSeconds: projectFields.targetDurationSeconds.default(480),
  language: projectFields.language.default("en"),
  visualStyle: projectFields.visualStyle.default(""),
});

// Patches are declared without defaults: Zod 4 applies defaults inside
// optional fields, which would silently reset untouched columns.
export const ProjectPatchSchema = z.strictObject(projectFields).partial();

// ------------------------------------------------------------------ assets

export const AssetKindSchema = z.enum(ASSET_KINDS);
export const AssetOriginSchema = z.enum(["imported", "generated"]);

export const AssetSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  kind: AssetKindSchema,
  origin: AssetOriginSchema,
  /** Relative to the library's media root, always forward-slashed. */
  relativePath: z.string(),
  thumbnailPath: z.string().nullable(),
  originalFilename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  durationSeconds: z.number().nonnegative().nullable(),
  createdAt: Timestamp,
});
export type Asset = z.infer<typeof AssetSchema>;

export const ProjectSummarySchema = ProjectSchema.extend({
  episodeCount: z.number().int().nonnegative(),
  sceneCount: z.number().int().nonnegative(),
  totalDurationSeconds: z.number().nonnegative(),
  coverAsset: AssetSchema.nullable(),
});
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

// ---------------------------------------------------------------- episodes

export const ProductionStateSchema = z.enum([
  "draft",
  "in_production",
  "ready",
  "exported",
]);
export type ProductionState = z.infer<typeof ProductionStateSchema>;

const episodeFields = {
  title: z.string().trim().min(1, "Title is required").max(160),
  script: z.string().max(200_000),
  productionState: ProductionStateSchema,
  /** Loudness of the background music under narration, 0 to 1. */
  musicVolume: z.number().min(0).max(1),
};

export const EpisodeSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  sequenceIndex: z.number().int().nonnegative(),
  ...episodeFields,
  /** Background music for the whole episode, an audio asset. */
  musicAssetId: IdSchema.nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type Episode = z.infer<typeof EpisodeSchema>;

export const EpisodeCreateSchema = z.strictObject({
  projectId: IdSchema,
  title: episodeFields.title,
});

export const EpisodePatchSchema = z.strictObject(episodeFields).partial();

/** List row: everything except the (potentially large) script body. */
export const EpisodeSummarySchema = EpisodeSchema.omit({ script: true }).extend(
  {
    sceneCount: z.number().int().nonnegative(),
    totalDurationSeconds: z.number().nonnegative(),
    coverAsset: AssetSchema.nullable(),
  },
);
export type EpisodeSummary = z.infer<typeof EpisodeSummarySchema>;

// ------------------------------------------------------------------ scenes

export const CAMERA_MOTIONS = [
  "static",
  "push_in",
  "pull_out",
  "pan_left",
  "pan_right",
  "tilt_up",
  "tilt_down",
  "orbit",
  "handheld",
] as const;
export const CameraMotionSchema = z.enum(CAMERA_MOTIONS);
export type CameraMotion = z.infer<typeof CameraMotionSchema>;

export const GenerationStateSchema = z.enum([
  "idle",
  "queued",
  "generating",
  "ready",
  "failed",
]);
export type GenerationState = z.infer<typeof GenerationStateSchema>;

/** How a scene begins: a hard cut, or a cross-fade from the scene before. */
export const TRANSITIONS = ["cut", "fade"] as const;
export const TransitionSchema = z.enum(TRANSITIONS);
export type Transition = z.infer<typeof TransitionSchema>;

export const OVERLAY_POSITIONS = ["top", "center", "bottom"] as const;
export const OverlayPositionSchema = z.enum(OVERLAY_POSITIONS);
export type OverlayPosition = z.infer<typeof OverlayPositionSchema>;

export const SCENE_DURATION_MIN = 0.5;
export const SCENE_DURATION_MAX = 600;

const sceneFields = {
  title: z.string().max(160),
  description: z.string().max(2000),
  durationSeconds: z.number().min(SCENE_DURATION_MIN).max(SCENE_DURATION_MAX),
  narrationText: z.string().max(10_000),
  imagePrompt: z.string().max(4000),
  motionPrompt: z.string().max(4000),
  cameraMotion: CameraMotionSchema,
  cameraInstructions: z.string().max(2000),
  /** Engine id chosen to animate this scene, or null for manual import. */
  animationEngine: z.string().max(80).nullable(),
  transition: TransitionSchema,
  /** Text shown over the picture for the whole scene. Empty for none. */
  overlayText: z.string().max(300),
  overlayPosition: OverlayPositionSchema,
};

export const SceneSchema = z.object({
  id: IdSchema,
  episodeId: IdSchema,
  sequenceIndex: z.number().int().nonnegative(),
  ...sceneFields,
  imageAssetId: IdSchema.nullable(),
  videoAssetId: IdSchema.nullable(),
  audioAssetId: IdSchema.nullable(),
  generationState: GenerationStateSchema,
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type Scene = z.infer<typeof SceneSchema>;

export const ScenePatchSchema = z.strictObject(sceneFields).partial();
export type ScenePatch = z.infer<typeof ScenePatchSchema>;

export const SceneCreateSchema = z.strictObject({
  episodeId: IdSchema,
  /** Insert directly after this scene. Appends when omitted. */
  afterSceneId: IdSchema.optional(),
  fields: ScenePatchSchema.optional(),
});

/** A scene slot is named after the kind of asset it holds. */
export const SceneSlotSchema = AssetKindSchema;
export type SceneSlot = z.infer<typeof SceneSlotSchema>;

export const EpisodeDetailSchema = z.object({
  episode: EpisodeSchema,
  scenes: z.array(SceneSchema),
  /** Every asset referenced by a scene in this episode. */
  assets: z.array(AssetSchema),
});
export type EpisodeDetail = z.infer<typeof EpisodeDetailSchema>;

// -------------------------------------------------------------------- jobs

/**
 * Kinds of background work. Everything except `media_import` is a production
 * task that an engine adapter performs.
 */
export const JOB_TYPES = [
  "media_import",
  "image_generation",
  "video_generation",
  "audio_generation",
  "video_render",
  /** A Video DNA analysis by the local language model. */
  "research_analysis",
  /** A Story Architect outline or script by the local language model. */
  "story_generation",
  /** A Scene Doctor inspection of a finished video. */
  "video_inspection",
] as const;
export const JobTypeSchema = z.enum(JOB_TYPES);
export type JobType = z.infer<typeof JobTypeSchema>;

export const PRODUCTION_TASKS = [
  "image_generation",
  "video_generation",
  "audio_generation",
  "video_render",
] as const;
export const ProductionTaskSchema = z.enum(PRODUCTION_TASKS);
export type ProductionTask = z.infer<typeof ProductionTaskSchema>;

/**
 * pending     - waiting for its turn; nothing has started
 * running     - an executor is working on it right now
 * completed   - finished and produced its output
 * failed      - stopped with an error
 * cancelled   - stopped because the user asked
 * interrupted - was running when the application stopped. Its work is lost
 *               and it is never restarted automatically.
 */
export const JOB_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
] as const;
export const JobStatusSchema = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof JobStatusSchema>;

/**
 * What a running job is doing. A generation goes preparing, loading_model,
 * generating, validating; an adapter that cannot tell loading from generating
 * stays in "generating". A video build goes preflight, preparing, composing,
 * rendering, verifying.
 */
export const JOB_STAGES = [
  "preparing",
  "loading_model",
  "generating",
  "validating",
  // A video build: its checks, its timeline, drawing and encoding, and the
  // inspection of the file before anything reports success.
  "preflight",
  "composing",
  "rendering",
  "verifying",
  // An inspection: reading the whole video, then taking evidence pictures.
  "analyzing",
  "extracting",
] as const;
export const JobStageSchema = z.enum(JOB_STAGES);
export type JobStage = z.infer<typeof JobStageSchema>;

export const JobSchema = z.object({
  id: IdSchema,
  type: JobTypeSchema,
  status: JobStatusSchema,
  label: z.string(),
  /** 0..1 when the work is measurable, otherwise null. Never estimated. */
  progress: z.number().min(0).max(1).nullable(),
  /** What the executor says it is doing, e.g. "Step 3 of 8". */
  progressMessage: z.string().nullable(),
  /** Phase of a running generation; the last one reached once it ends. */
  stage: JobStageSchema.nullable().default(null),
  /** Engine adapter that performs the job. Null for media imports. */
  adapterId: z.string().nullable(),
  model: z.string().nullable(),
  projectId: IdSchema.nullable(),
  episodeId: IdSchema.nullable(),
  sceneId: IdSchema.nullable(),
  /** Scene slot the output is meant for. */
  slot: AssetKindSchema.nullable(),
  /** Everything needed to run the job, captured when it was created. */
  input: z.record(z.string(), z.unknown()),
  output: z.record(z.string(), z.unknown()).nullable(),
  /** The library asset the job produced, once completed. */
  outputAssetId: IdSchema.nullable(),
  /** Facts about the execution: engine version, timings, capabilities. */
  metadata: z.record(z.string(), z.unknown()),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  /** 1 for a first run; each retry creates a new job with the next number. */
  attempt: z.number().int().positive(),
  retryOfJobId: IdSchema.nullable(),
  cancelRequestedAt: Timestamp.nullable(),
  createdAt: Timestamp,
  startedAt: Timestamp.nullable(),
  finishedAt: Timestamp.nullable(),
  updatedAt: Timestamp,
});
export type Job = z.infer<typeof JobSchema>;

/** Waiting or working: the job still occupies its place in the queue. */
export function isActiveJob(job: Pick<Job, "status">): boolean {
  return job.status === "pending" || job.status === "running";
}

/** Ended without producing output, so the user may run it again. */
export function isRetryableJob(job: Pick<Job, "status">): boolean {
  return (
    job.status === "failed" ||
    job.status === "cancelled" ||
    job.status === "interrupted"
  );
}

export const QueueStatusSchema = z.object({
  /** While paused, no production job is started. Running jobs continue. */
  paused: z.boolean(),
  /**
   * "restart" means the queue was held because jobs were still waiting when
   * the application last stopped. They are never started without the user.
   */
  pausedReason: z.enum(["user", "restart"]).nullable(),
  pendingCount: z.number().int().nonnegative(),
  runningCount: z.number().int().nonnegative(),
});
export type QueueStatus = z.infer<typeof QueueStatusSchema>;

// ---------------------------------------------------------------- settings

export const STUDIO_TABS = [
  "projects",
  "script",
  "scenes",
  "blueprint",
  "production",
  "export",
  "models",
  "research",
  "doctor",
] as const;
export const StudioTabSchema = z.enum(STUDIO_TABS);
export type StudioTab = z.infer<typeof StudioTabSchema>;

/** Languages the interface is translated into; English is the source. */
export const UI_LANGUAGES = ["en", "es", "pt-BR", "tr", "de"] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];

const settingsFields = {
  defaultSceneDurationSeconds: z
    .number()
    .min(SCENE_DURATION_MIN)
    .max(SCENE_DURATION_MAX),
  narrationWordsPerMinute: z.number().int().min(80).max(260),
  continuousPlayback: z.boolean(),
  activityPanelOpen: z.boolean(),
  /**
   * Port of the Draw Things HTTP API server on this computer. Only the port
   * is configurable: the address is always the loopback interface.
   */
  drawThingsHttpPort: z.number().int().min(1024).max(65535),
  /**
   * Folder that new model installations are written to, or null for the
   * default inside the library. Existing installations stay where they are.
   */
  modelsDirectory: z.string().max(4096).nullable(),
  /**
   * Folder that finished videos are written to, or null for the "exports"
   * folder inside the library.
   */
  exportDirectory: z.string().max(4096).nullable(),
  exportResolution: z.enum(["1920x1080", "1280x720", "1080x1920"]),
  exportFps: z.union([
    z.literal(24),
    z.literal(25),
    z.literal(30),
    z.literal(60),
  ]),
  /**
   * "approximate" shows each scene's narration text as captions, timed by
   * sentence length rather than by the speech itself.
   */
  exportCaptions: z.enum(["none", "approximate"]),
  /**
   * A Python interpreter that has the `kokoro` package installed, used for
   * speech. Null until the user chooses one.
   */
  kokoroPython: z.string().max(4096).nullable(),
  /**
   * A Python interpreter that has the `mlx-audio` package installed, used
   * for Qwen3-TTS speech. Null until the user chooses one.
   */
  qwenTtsPython: z.string().max(4096).nullable(),
  /** Python with the pinned LTX MLX pipeline, selected explicitly. */
  ltxVideoPython: z.string().max(4096).nullable(),
  /** Optional external LTX pack; managed downloads are also offered. */
  ltxVideoModelDirectory: z.string().max(4096).nullable(),
  /** Optional local Real-ESRGAN animevideov3 MLX weights. */
  videoUpscalerDirectory: z.string().max(4096).nullable().default(null),
  /** Local Gemma encoder; null uses its verified Model Manager installation. */
  ltxVideoTextEncoderDirectory: z.string().max(4096).nullable(),
  /**
   * A folder of Qwen3-TTS voice profiles (or one profile folder): each a
   * voice.json with a reference recording. Null until the user chooses one.
   */
  qwenVoicesDirectory: z.string().max(4096).nullable(),
  /**
   * The Chrome build Remotion renders with. Null uses the one Remotion
   * manages itself.
   */
  rendererBrowserPath: z.string().max(4096).nullable(),
  /**
   * The llama.cpp server program that runs language models. Null until the
   * user chooses one; Framebop starts and stops it itself.
   */
  llamaServerPath: z.string().max(4096).nullable(),
  /**
   * Where a newer Framebop model registry can be fetched, on request. Null
   * uses only the registry that ships with the app.
   */
  registryUrl: z.string().max(2048).nullable(),
  /**
   * The interface language, or "system" to follow the operating system's
   * preferences. Independent of every project's content language.
   */
  uiLanguage: z.enum(["system", ...UI_LANGUAGES]),
  /** Where the user left off, restored on next launch. */
  session: z.object({
    tab: StudioTabSchema,
    projectId: IdSchema.nullable(),
    episodeId: IdSchema.nullable(),
    sceneId: IdSchema.nullable(),
  }),
};

export const AppSettingsSchema = z.object(settingsFields);
export type AppSettings = z.infer<typeof AppSettingsSchema>;

export const AppSettingsPatchSchema = z.strictObject(settingsFields).partial();
export type AppSettingsPatch = z.infer<typeof AppSettingsPatchSchema>;

export const DEFAULT_SETTINGS: AppSettings = {
  defaultSceneDurationSeconds: 5,
  narrationWordsPerMinute: 150,
  continuousPlayback: true,
  activityPanelOpen: true,
  drawThingsHttpPort: 7860,
  modelsDirectory: null,
  exportDirectory: null,
  exportResolution: "1920x1080",
  exportFps: 30,
  exportCaptions: "none",
  kokoroPython: null,
  qwenTtsPython: null,
  ltxVideoPython: null,
  ltxVideoModelDirectory: null,
  videoUpscalerDirectory: null,
  ltxVideoTextEncoderDirectory: null,
  qwenVoicesDirectory: null,
  rendererBrowserPath: null,
  llamaServerPath: null,
  registryUrl: null,
  uiLanguage: "system",
  session: { tab: "projects", projectId: null, episodeId: null, sceneId: null },
};

// ------------------------------------------------------------ system state

export const ToolStatusSchema = z.object({
  available: z.boolean(),
  path: z.string().nullable(),
  version: z.string().nullable(),
});
export type ToolStatus = z.infer<typeof ToolStatusSchema>;

export const SystemInfoSchema = z.object({
  appVersion: z.string(),
  /** The operating system's preferred languages, most preferred first. */
  preferredLanguages: z.array(z.string()),
  schemaVersion: z.number().int(),
  dataDir: z.string(),
  mediaRoot: z.string(),
  databasePath: z.string(),
  logFile: z.string(),
  platform: z.string(),
  arch: z.string(),
  osRelease: z.string(),
  runtimeVersion: z.string(),
  hardware: z.object({
    cpuModel: z.string(),
    cpuCores: z.number().int(),
    totalMemoryBytes: z.number(),
    /**
     * GPU compute backend detected on this machine. "unknown" means detection
     * for this platform is not implemented yet, not that no GPU exists.
     */
    accelerator: z.enum(["apple-metal", "unknown"]),
  }),
  tools: z.object({ ffmpeg: ToolStatusSchema, ffprobe: ToolStatusSchema }),
});
export type SystemInfo = z.infer<typeof SystemInfoSchema>;

export const EngineKindSchema = z.enum([
  "import",
  "tool",
  "image",
  "video",
  "speech",
  "render",
]);
export type EngineKind = z.infer<typeof EngineKindSchema>;

/**
 * available  - integrated and usable right now
 * detected   - software found on this machine, but not usable as it is
 * not_found  - required software is not installed or not reachable
 * planned    - integration not written yet
 */
export const EngineStateSchema = z.enum([
  "available",
  "detected",
  "not_found",
  "planned",
]);
export type EngineState = z.infer<typeof EngineStateSchema>;

/** A setting an engine exposes for one generation. */
export const ParameterSpecSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(["number", "integer", "boolean", "string", "enum"]),
  defaultValue: z.union([z.number(), z.boolean(), z.string()]),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  /** Allowed values when `type` is "enum". */
  options: z.array(z.string()).optional(),
  description: z.string().optional(),
});
export type ParameterSpec = z.infer<typeof ParameterSpecSchema>;

export const ParameterValueSchema = z.union([
  z.number(),
  z.boolean(),
  z.string().max(4000),
]);
export type ParameterValue = z.infer<typeof ParameterValueSchema>;

/**
 * How far an integration can be trusted.
 *
 * verified     - exercised against the real engine by the project's tests
 * experimental - written from the engine's documented interface, not yet
 *                confirmed against a live installation
 * test         - produces placeholder output and involves no AI model
 */
export const AdapterMaturitySchema = z.enum([
  "verified",
  "experimental",
  "test",
]);
export type AdapterMaturity = z.infer<typeof AdapterMaturitySchema>;

/** What one engine can do for one kind of production task, right now. */
export const EngineCapabilitySchema = z.object({
  task: ProductionTaskSchema,
  available: z.boolean(),
  /** Why the task cannot be run at the moment. Null when available. */
  reason: z.string().nullable(),
  maturity: AdapterMaturitySchema,
  /** Models to choose from. Empty when the engine decides for itself. */
  models: z.array(z.object({ id: z.string(), name: z.string() })),
  /** Whether a model must be named, as free text if `models` is empty. */
  requiresModel: z.boolean(),
  parameters: z.array(ParameterSpecSchema),
  /** Output sizes on offer. Empty when the engine has no fixed list. */
  resolutions: z.array(z.object({ width: z.number(), height: z.number() })),
  requiresPrompt: z.boolean(),
  /** Whether the task starts from the scene's still image. */
  requiresInputImage: z.boolean(),
  /**
   * Whether a starting image can be given at all: image-to-image for
   * pictures, image-to-video for clips. True whenever one is required.
   */
  acceptsInputImage: z.boolean().default(false),
  /** Whether a negative prompt reaches the model. Never dropped silently. */
  supportsNegativePrompt: z.boolean().default(false),
  /** Whether a chosen seed reaches the model, so a run can be repeated. */
  supportsSeed: z.boolean().default(false),
  /** Longest clip the engine makes, when it is known. */
  maxClipSeconds: z.number().positive().nullable().default(null),
  /** MIME types of the files the engine writes. */
  outputFormats: z.array(z.string()).default([]),
  /** False means a started generation runs to the end no matter what. */
  supportsCancellation: z.boolean(),
  /** False means progress is unknown until the job ends. */
  reportsProgress: z.boolean(),
  /**
   * True when a run may take minutes and most of the machine's memory. Such
   * jobs are only created after the user has explicitly agreed.
   */
  expensive: z.boolean(),
  /** Limitations the user should know before starting. */
  notes: z.array(z.string()),
});
export type EngineCapability = z.infer<typeof EngineCapabilitySchema>;

export const EngineStatusSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: EngineKindSchema,
  state: EngineStateSchema,
  summary: z.string(),
  detail: z.string(),
  version: z.string().nullable(),
  location: z.string().nullable(),
  /** Roadmap phase that delivers the integration, when not yet available. */
  plannedPhase: z.number().int().nullable(),
  /** True for adapters that exist to test the application, not to create. */
  isTest: z.boolean(),
  /** Production tasks this engine has an adapter for. */
  capabilities: z.array(EngineCapabilitySchema),
});
export type EngineStatus = z.infer<typeof EngineStatusSchema>;

export const LogLevelSchema = z.enum(["debug", "info", "warn", "error"]);
export type LogLevel = z.infer<typeof LogLevelSchema>;

export const LogEntrySchema = z.object({
  seq: z.number().int(),
  time: Timestamp,
  level: LogLevelSchema,
  scope: z.string(),
  message: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
});
export type LogEntry = z.infer<typeof LogEntrySchema>;
