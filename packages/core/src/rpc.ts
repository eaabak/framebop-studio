import { z } from "zod";
import {
  AnimationBlueprintSchema,
  AnimationCapabilitySchema,
  CapabilityInfoSchema,
  DirectorNoticeSchema,
  DirectorResultSchema,
  QualityReportSchema,
} from "./director";
import {
  AppSettingsPatchSchema,
  AppSettingsSchema,
  type Asset,
  AssetSchema,
  EngineStatusSchema,
  type Episode,
  EpisodeCreateSchema,
  EpisodeDetailSchema,
  EpisodePatchSchema,
  EpisodeSchema,
  EpisodeSummarySchema,
  IdSchema,
  type Job,
  JobSchema,
  type LogEntry,
  LogEntrySchema,
  ProjectCreateSchema,
  ProjectPatchSchema,
  ProjectSchema,
  ParameterValueSchema,
  ProjectSummarySchema,
  type QueueStatus,
  QueueStatusSchema,
  type Scene,
  SceneCreateSchema,
  ScenePatchSchema,
  SceneSchema,
  SceneSlotSchema,
  SystemInfoSchema,
} from "./domain";
import {
  ExternalModelSchema,
  HardwareInventorySchema,
  GenerationCategorySchema,
  HubKitSchema,
  HubModelDetailsSchema,
  HubSearchPageSchema,
  ImageRuntimeStatusSchema,
  ModelChoiceSchema,
  type ModelInstallation,
  ModelInstallationSchema,
  ModelSourceSchema,
  ModelStatusSchema,
  RegistryStatusSchema,
  StorageReportSchema,
  VoiceSchema,
  VoiceSetupStatusSchema,
} from "./models";
import {
  BlueprintSchema,
  PreflightReportSchema,
  ScenePlanPatchSchema,
  ScenePlanSchema,
  VisualReferenceSaveSchema,
  VisualReferenceSchema,
} from "./blueprint";
import { AnimationTemplateSchema } from "./animation";
import { ArtStyleSchema } from "./direction";
import {
  VOICE_RECORDING_MAX_BASE64,
  VoiceLibrarySchema,
  VoicePacingSchema,
  VoicePreviewSchema,
  VoiceProfileIdSchema,
  VoiceProfileInfoSchema,
  VoiceSpeakerSchema,
  VoiceStyleSchema,
} from "./voice-clone";
import {
  DoctorExportSchema,
  InspectRequestSchema,
  InspectionSchema,
} from "./doctor";
import {
  AnimationPreviewSchema,
  RenderPreviewSchema,
  RenderRecordSchema,
} from "./render";
import {
  StoryDraftSchema,
  StoryDraftSummarySchema,
  StoryEditableSchema,
  StoryScopeSchema,
} from "./story";
import {
  AnalysisCapabilitySchema,
  LocalLlmStatusSchema,
  ResearchAnalysisSchema,
  CommentOrderSchema,
  CommentPageSchema,
  CommentSampleSchema,
  ManualMetadataSchema,
  MetadataSnapshotSchema,
  NoteCreateSchema,
  ReferenceVideoDetailSchema,
  ReferenceVideoSchema,
  ResearchFindingSchema,
  ResearchProjectCreateSchema,
  ResearchProjectDetailSchema,
  ResearchProjectPatchSchema,
  ResearchProjectSchema,
  ResearchProjectSummarySchema,
  TranscriptDetailSchema,
  TranscriptImportSchema,
  TranscriptSchema,
  YouTubeApiKeySchema,
  YouTubeKeyStatusSchema,
} from "./research";

const Empty = z.strictObject({});
const Deleted = z.object({ deleted: z.literal(true) });
const AbsolutePath = z.string().min(1).max(4096);

function method<P extends z.ZodType, R extends z.ZodType>(
  params: P,
  result: R,
) {
  return { params, result };
}

/**
 * The complete surface the UI may call on the engine. Parameters are
 * validated against these schemas before any handler runs; results are
 * checked against them in the contract tests.
 */
export const rpcContract = {
  "system.info": method(Empty, SystemInfoSchema),
  "engines.list": method(Empty, z.array(EngineStatusSchema)),

  "settings.get": method(Empty, AppSettingsSchema),
  "settings.update": method(
    z.strictObject({ patch: AppSettingsPatchSchema }),
    AppSettingsSchema,
  ),

  "projects.list": method(Empty, z.array(ProjectSummarySchema)),
  "projects.create": method(ProjectCreateSchema, ProjectSchema),
  "projects.update": method(
    z.strictObject({ id: IdSchema, patch: ProjectPatchSchema }),
    ProjectSchema,
  ),
  "projects.delete": method(z.strictObject({ id: IdSchema }), Deleted),

  "episodes.list": method(
    z.strictObject({ projectId: IdSchema }),
    z.array(EpisodeSummarySchema),
  ),
  "episodes.get": method(z.strictObject({ id: IdSchema }), EpisodeDetailSchema),
  "episodes.create": method(EpisodeCreateSchema, EpisodeSchema),
  "episodes.update": method(
    z.strictObject({ id: IdSchema, patch: EpisodePatchSchema }),
    EpisodeSchema,
  ),
  "episodes.delete": method(z.strictObject({ id: IdSchema }), Deleted),
  /** Copies an audio file into the library as the episode's background music. */
  "episodes.importMusic": method(
    z.strictObject({ episodeId: IdSchema, sourcePath: AbsolutePath }),
    JobSchema,
  ),
  "episodes.removeMusic": method(
    z.strictObject({ episodeId: IdSchema }),
    EpisodeSchema,
  ),

  "scenes.create": method(SceneCreateSchema, SceneSchema),
  "scenes.update": method(
    z.strictObject({ id: IdSchema, patch: ScenePatchSchema }),
    SceneSchema,
  ),
  "scenes.duplicate": method(z.strictObject({ id: IdSchema }), SceneSchema),
  "scenes.delete": method(z.strictObject({ id: IdSchema }), Deleted),
  "scenes.reorder": method(
    z.strictObject({ episodeId: IdSchema, orderedSceneIds: z.array(IdSchema) }),
    z.array(SceneSchema),
  ),
  "scenes.createFromScript": method(
    z.strictObject({
      episodeId: IdSchema,
      mode: z.enum(["append", "replace"]),
    }),
    z.array(SceneSchema),
  ),
  "scenes.clearSlot": method(
    z.strictObject({ sceneId: IdSchema, slot: SceneSlotSchema }),
    SceneSchema,
  ),

  /** Starts a background import and returns its job immediately. */
  "assets.import": method(
    z.strictObject({
      sceneId: IdSchema,
      slot: SceneSlotSchema,
      sourcePath: AbsolutePath,
    }),
    JobSchema,
  ),

  /**
   * Lets the interface supply dimensions and duration it measured while
   * showing a file, for assets the engine could not analyse itself. Values
   * the engine already has are never replaced.
   */
  "assets.reportMetadata": method(
    z.strictObject({
      assetId: IdSchema,
      width: z.number().int().positive().max(100_000).nullable(),
      height: z.number().int().positive().max(100_000).nullable(),
      durationSeconds: z.number().positive().max(86_400).nullable(),
    }),
    AssetSchema,
  ),

  /** Looks up assets by id. Unknown ids are left out of the result. */
  "assets.getMany": method(
    z.strictObject({ ids: z.array(IdSchema).max(200) }),
    z.array(AssetSchema),
  ),

  "jobs.list": method(
    z.strictObject({ limit: z.number().int().min(1).max(500).default(200) }),
    z.array(JobSchema),
  ),
  /**
   * Queues a production job for a scene. The scene's prompts, duration and
   * still image are captured at this moment, so later edits do not change a
   * job that is already waiting.
   */
  "jobs.createGeneration": method(
    z.strictObject({
      sceneId: IdSchema,
      task: z.enum([
        "image_generation",
        "video_generation",
        "audio_generation",
      ]),
      adapterId: z.string().min(1).max(80),
      /**
       * A name the engine knows, or the reference of a model from
       * `models.choices` (which can be an absolute path).
       */
      model: z.string().trim().max(1024).nullable().default(null),
      /** Required for images and clips; unused for narration. */
      width: z.number().int().min(64).max(8192).optional(),
      height: z.number().int().min(64).max(8192).optional(),
      parameters: z
        .record(z.string().max(80), ParameterValueSchema)
        .default({}),
      /** The prompt to send, as edited. Omitted: the scene's own prompt. */
      prompt: z.string().trim().max(4000).optional(),
      /** Rejected for engines that cannot take one, never dropped. */
      negativePrompt: z.string().trim().max(2000).default(""),
      /** Null for a new random seed. Rejected if the engine takes none. */
      seed: z.number().int().min(0).max(4_294_967_295).nullable().default(null),
      /**
       * The starting image: image-to-image for pictures, image-to-video for
       * clips. Omitted: the scene's own image for clips, none for pictures.
       */
      inputImageAssetId: IdSchema.nullable().optional(),
      /** Clip length to ask for. Omitted: the scene's length. */
      clipSeconds: z.number().positive().max(600).optional(),
      /** References whose words are added to the prompt. */
      visualReferenceIds: z.array(IdSchema).max(12).default([]),
      /**
       * Must be true for engines whose runs are expensive. It records that
       * the user was told what the run costs and chose to start it.
       */
      approvedExpensive: z.boolean().default(false),
    }),
    JobSchema,
  ),
  "jobs.cancel": method(z.strictObject({ id: IdSchema }), JobSchema),
  /** Starts a new attempt with the same input. The old job is kept. */
  "jobs.retry": method(z.strictObject({ id: IdSchema }), JobSchema),
  /** Puts a completed job's output into its scene, replacing what is there. */
  "jobs.applyOutput": method(z.strictObject({ id: IdSchema }), SceneSchema),
  "jobs.clearFinished": method(Empty, z.object({ removed: z.number().int() })),

  "queue.status": method(Empty, QueueStatusSchema),
  "queue.setPaused": method(
    z.strictObject({ paused: z.boolean() }),
    QueueStatusSchema,
  ),

  "logs.recent": method(
    z.strictObject({ limit: z.number().int().min(1).max(1000).default(200) }),
    z.array(LogEntrySchema),
  ),

  "hardware.inspect": method(
    z.strictObject({ refresh: z.boolean().default(false) }),
    HardwareInventorySchema,
  ),

  /** Every catalog model with its installation, compatibility and runnability. */
  "models.list": method(Empty, z.array(ModelStatusSchema)),
  /**
   * Starts downloading a catalog model. `approved` records that the user saw
   * the download size, the files and the licence and chose to proceed.
   */
  "models.install": method(
    z.strictObject({ modelId: z.string(), approved: z.literal(true) }),
    ModelInstallationSchema,
  ),
  "models.cancel": method(
    z.strictObject({ modelId: z.string() }),
    ModelInstallationSchema,
  ),
  /** Resumes a failed or interrupted download, or restarts a cancelled one. */
  "models.retry": method(
    z.strictObject({ modelId: z.string() }),
    ModelInstallationSchema,
  ),
  /** Hashes the installed files again and records the result. */
  "models.verify": method(
    z.strictObject({ modelId: z.string() }),
    ModelInstallationSchema,
  ),
  /** Deletes a managed installation's own files. External models cannot be removed. */
  "models.remove": method(z.strictObject({ modelId: z.string() }), Deleted),
  "models.storage": method(Empty, StorageReportSchema),
  "models.setStorageRoot": method(
    z.strictObject({ path: AbsolutePath.nullable() }),
    StorageReportSchema,
  ),

  "models.sources": method(Empty, z.array(ModelSourceSchema)),
  /** Registers a folder (or the Hugging Face cache) to look for models in. */
  "models.addSource": method(
    z.strictObject({
      kind: z.enum(["folder", "huggingface-cache"]),
      path: AbsolutePath,
    }),
    ModelSourceSchema,
  ),
  /** Forgets a source. Its files are not touched. */
  "models.removeSource": method(z.strictObject({ id: z.string() }), Deleted),
  "models.scanSources": method(Empty, z.array(ExternalModelSchema)),
  "models.external": method(Empty, z.array(ExternalModelSchema)),
  "registry.status": method(Empty, RegistryStatusSchema),
  /** Fetches the registry from the address in settings. Only on request. */
  "registry.refresh": method(Empty, RegistryStatusSchema),
  /** One page of Hugging Face's model search. Network, on request only. */
  "hub.search": method(
    z.strictObject({
      query: z.string().max(100).default(""),
      category: GenerationCategorySchema.nullable().default(null),
      cursor: z.string().max(2000).nullable().default(null),
      sort: z
        .enum(["downloads", "likes", "trending", "recent"])
        .default("downloads"),
    }),
    HubSearchPageSchema,
  ),
  "hub.model": method(
    z.strictObject({ repoId: z.string().min(3).max(200) }),
    HubModelDetailsSchema,
  ),
  /** Adds a runnable Hugging Face repository to the user's models. */
  "hub.import": method(
    z.strictObject({
      repoId: z.string().min(3).max(200),
      /** For a kit repository: the files chosen and what each does. */
      kit: HubKitSchema.optional(),
    }),
    ModelStatusSchema,
  ),
  "models.removeImported": method(
    z.strictObject({ modelId: z.string() }),
    Deleted,
  ),
  /** Everything one generation engine could be given as its model. */
  "models.choices": method(
    z.strictObject({
      task: z.enum([
        "image_generation",
        "video_generation",
        "audio_generation",
      ]),
      adapterId: z.string().min(1).max(80),
    }),
    z.array(ModelChoiceSchema),
  ),

  /** The plan an episode would render with now, and anything to know first. */
  "render.preview": method(
    z.strictObject({ episodeId: IdSchema }),
    RenderPreviewSchema,
  ),
  /** Queues a render of the episode with the export settings. */
  "render.start": method(z.strictObject({ episodeId: IdSchema }), JobSchema),
  "renders.list": method(
    z.strictObject({ episodeId: IdSchema }),
    z.array(RenderRecordSchema),
  ),
  /** Removes a render from the list. The video file is never deleted. */
  "renders.forget": method(z.strictObject({ id: z.string() }), Deleted),
  /** Voices a speech engine offers with one of its models. */
  "audio.voices": method(
    z.strictObject({
      adapterId: z.string().min(1).max(80),
      model: z.string().min(1).max(1024),
    }),
    z.array(VoiceSchema),
  ),

  "export.episodeManifest": method(
    z.strictObject({ episodeId: IdSchema, targetPath: AbsolutePath }),
    z.object({ path: z.string(), sizeBytes: z.number().int() }),
  ),

  // Video DNA Lab. Only the "fetch" calls go online, and only on request.
  "research.projects.list": method(
    Empty,
    z.array(ResearchProjectSummarySchema),
  ),
  "research.projects.get": method(
    z.strictObject({ id: IdSchema }),
    ResearchProjectDetailSchema,
  ),
  "research.projects.create": method(
    ResearchProjectCreateSchema,
    ResearchProjectSchema,
  ),
  "research.projects.update": method(
    z.strictObject({ id: IdSchema, patch: ResearchProjectPatchSchema }),
    ResearchProjectSchema,
  ),
  "research.projects.delete": method(z.strictObject({ id: IdSchema }), Deleted),
  /** Adds a YouTube video by link. Nothing is fetched. */
  "research.videos.add": method(
    z.strictObject({ projectId: IdSchema, link: z.string().max(4096) }),
    ReferenceVideoSchema,
  ),
  "research.videos.get": method(
    z.strictObject({ id: IdSchema }),
    ReferenceVideoDetailSchema,
  ),
  "research.videos.update": method(
    z.strictObject({
      id: IdSchema,
      patch: z.strictObject({ notes: z.string().max(10_000) }),
    }),
    ReferenceVideoSchema,
  ),
  /** Removes the video and everything collected for it. */
  "research.videos.remove": method(z.strictObject({ id: IdSchema }), Deleted),
  /** Two quota units: videos.list and channels.list. */
  "research.metadata.fetch": method(
    z.strictObject({ referenceVideoId: IdSchema }),
    MetadataSnapshotSchema,
  ),
  "research.metadata.saveManual": method(
    z.strictObject({
      referenceVideoId: IdSchema,
      values: ManualMetadataSchema,
    }),
    MetadataSnapshotSchema,
  ),
  "research.metadata.deleteSnapshot": method(
    z.strictObject({ id: IdSchema }),
    Deleted,
  ),
  /**
   * One page of up to 100 top-level comments, one quota unit. "start"
   * replaces any stored sample; "more" continues it.
   */
  "research.comments.fetch": method(
    z.strictObject({
      referenceVideoId: IdSchema,
      order: CommentOrderSchema.default("relevance"),
      mode: z.enum(["start", "more"]),
    }),
    CommentSampleSchema,
  ),
  "research.comments.list": method(
    z.strictObject({
      referenceVideoId: IdSchema,
      query: z.string().max(200).default(""),
      sort: z.enum(["youtube", "likes", "newest"]).default("youtube"),
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(200).default(50),
    }),
    CommentPageSchema,
  ),
  "research.comments.clear": method(
    z.strictObject({ referenceVideoId: IdSchema }),
    Deleted,
  ),
  "research.transcripts.import": method(
    TranscriptImportSchema,
    TranscriptSchema,
  ),
  "research.transcripts.get": method(
    z.strictObject({ id: IdSchema }),
    TranscriptDetailSchema,
  ),
  "research.transcripts.delete": method(
    z.strictObject({ id: IdSchema }),
    Deleted,
  ),
  "research.notes.create": method(NoteCreateSchema, ResearchFindingSchema),
  "research.notes.delete": method(z.strictObject({ id: IdSchema }), Deleted),
  "research.key.status": method(Empty, YouTubeKeyStatusSchema),
  /** Stores the key in the system's secure storage. It is never returned. */
  "research.key.set": method(
    z.strictObject({ apiKey: YouTubeApiKeySchema }),
    YouTubeKeyStatusSchema,
  ),
  "research.key.clear": method(Empty, YouTubeKeyStatusSchema),
  /** AI analyses and whether this build can run them (none yet). */
  "research.analysis.capabilities": method(
    Empty,
    z.array(AnalysisCapabilitySchema),
  ),
  /** Queues the six analyses of a video with a local language model. */
  "research.analysis.start": method(
    z.strictObject({
      referenceVideoId: IdSchema,
      modelId: z.string().min(1).max(80),
    }),
    ResearchAnalysisSchema,
  ),
  "research.analysis.list": method(
    z.strictObject({ referenceVideoId: IdSchema }),
    z.array(ResearchAnalysisSchema),
  ),
  "research.analysis.get": method(
    z.strictObject({ id: IdSchema }),
    ResearchAnalysisSchema,
  ),
  "research.analysis.cancel": method(
    z.strictObject({ id: IdSchema }),
    ResearchAnalysisSchema,
  ),
  "research.analysis.delete": method(z.strictObject({ id: IdSchema }), Deleted),

  /** The local llama.cpp runtime and the language models it can use. */
  // Production Blueprint: plans and readiness. Nothing here makes media.
  "blueprint.get": method(
    z.strictObject({ episodeId: IdSchema }),
    BlueprintSchema,
  ),
  "blueprint.updatePlan": method(
    z.strictObject({ sceneId: IdSchema, patch: ScenePlanPatchSchema }),
    ScenePlanSchema,
  ),
  /** One scene's animation, to play in the editor as the render draws it. */
  "blueprint.animationPreview": method(
    z.strictObject({ sceneId: IdSchema }),
    AnimationPreviewSchema,
  ),
  /** Draws a scene with one of the 2D engine's ready-made animations. */
  "blueprint.applyAnimationTemplate": method(
    z.strictObject({ sceneId: IdSchema, template: AnimationTemplateSchema }),
    ScenePlanSchema,
  ),
  "blueprint.preflight": method(
    z.strictObject({ episodeId: IdSchema }),
    PreflightReportSchema,
  ),
  /** Sets the scene's duration to its narration audio's measured length. */
  "blueprint.useMeasuredDuration": method(
    z.strictObject({ sceneId: IdSchema }),
    SceneSchema,
  ),
  /** Queues a longer narration for one scene, kept as a suggestion. */
  "blueprint.suggestNarration": method(
    z.strictObject({ sceneId: IdSchema, modelId: z.string().min(1).max(80) }),
    JobSchema,
  ),
  "blueprint.acceptNarration": method(
    z.strictObject({ sceneId: IdSchema }),
    SceneSchema,
  ),
  "blueprint.discardNarration": method(
    z.strictObject({ sceneId: IdSchema }),
    ScenePlanSchema,
  ),
  /** Framebop exports in the library that can be inspected, newest first. */
  "runtimes.imageStatus": method(Empty, ImageRuntimeStatusSchema),
  /** Downloads and installs the pinned image runtime; needs consent. */
  "runtimes.installImage": method(
    z.strictObject({ approved: z.literal(true) }),
    ImageRuntimeStatusSchema,
  ),
  "runtimes.voiceStatus": method(Empty, VoiceSetupStatusSchema),
  /**
   * Starts installing the voice engine and the pack for a language; needs
   * consent. Returns at once; the status follows the download.
   */
  "runtimes.installVoice": method(
    z.strictObject({
      approved: z.literal(true),
      language: z.string().trim().min(2).max(35),
    }),
    VoiceSetupStatusSchema,
  ),
  "runtimes.llmStatus": method(Empty, ImageRuntimeStatusSchema),
  /** Downloads and installs the pinned language-model runtime; needs consent. */
  "runtimes.installLlm": method(
    z.strictObject({ approved: z.literal(true) }),
    ImageRuntimeStatusSchema,
  ),
  /**
   * Deletes what Framebop installed itself; needs consent. Refused while it
   * is being installed or used. Catalog models go through `models.remove`.
   */
  "runtimes.removeImage": method(
    z.strictObject({ approved: z.literal(true) }),
    ImageRuntimeStatusSchema,
  ),
  /** Deletes the voice program; the voice packs stay. */
  "runtimes.removeVoice": method(
    z.strictObject({ approved: z.literal(true) }),
    VoiceSetupStatusSchema,
  ),
  "runtimes.removeVoicePack": method(
    z.strictObject({
      approved: z.literal(true),
      packId: z.string().trim().min(1).max(80),
    }),
    VoiceSetupStatusSchema,
  ),
  "runtimes.removeLlm": method(
    z.strictObject({ approved: z.literal(true) }),
    ImageRuntimeStatusSchema,
  ),
  /** Writes a script draft from a topic with the local language model. */
  "script.write": method(
    z.strictObject({
      episodeId: IdSchema,
      topic: z.string().trim().min(3).max(1000),
      modelId: z.string().min(1).max(200).optional(),
    }),
    z.object({ script: z.string(), words: z.number().int() }),
  ),
  "script.cancel": method(Empty, Deleted),
  /** What the AI Animation Director can build, with each one's limits. */
  "director.capabilities": method(Empty, z.array(CapabilityInfoSchema)),
  /** A capability's starting plan in the scene's project language. */
  "director.defaults": method(
    z.strictObject({
      sceneId: IdSchema,
      capability: AnimationCapabilitySchema,
    }),
    AnimationBlueprintSchema,
  ),
  /** Plans an animation from an idea, or revises a plan, with the local model. */
  "director.plan": method(
    z.strictObject({
      sceneId: IdSchema,
      idea: z.string().trim().min(3).max(1000),
      previous: AnimationBlueprintSchema.optional(),
      instruction: z.string().trim().max(500).optional(),
      modelId: z.string().min(1).max(200).optional(),
      /** The art style the user chose; the plan keeps it. */
      style: ArtStyleSchema.optional(),
    }),
    DirectorResultSchema,
  ),
  "director.cancel": method(Empty, Deleted),
  /** Checks an edited plan; returns it as it would be built. */
  "director.normalize": method(
    z.strictObject({ blueprint: z.unknown() }),
    z.object({
      blueprint: AnimationBlueprintSchema,
      notices: z.array(DirectorNoticeSchema),
      quality: QualityReportSchema,
    }),
  ),
  /** Builds the scene's animation from a plan. */
  "director.apply": method(
    z.strictObject({ sceneId: IdSchema, blueprint: z.unknown() }),
    ScenePlanSchema,
  ),
  /** Qwen3-TTS voice profiles in the folder chosen in Settings. */
  "voices.list": method(Empty, VoiceLibrarySchema),
  /**
   * Makes a profile from a live microphone recording of the user reading
   * the consent sentence and paragraph. `ownVoice` records that the user
   * confirmed it is their own voice. Audio files are never accepted here
   * from anywhere but the in-app recorder.
   */
  "voices.saveRecording": method(
    z.strictObject({
      speaker: VoiceSpeakerSchema,
      style: VoiceStyleSchema,
      ownVoice: z.literal(true),
      /** The recording as a base64 16-bit mono WAV. */
      audio: z.string().min(64).max(VOICE_RECORDING_MAX_BASE64),
    }),
    VoiceProfileInfoSchema,
  ),
  "voices.updatePacing": method(
    z.strictObject({ id: VoiceProfileIdSchema, pacing: VoicePacingSchema }),
    VoiceProfileInfoSchema,
  ),
  /** Deletes a profile the user recorded; other profiles are never touched. */
  "voices.delete": method(
    z.strictObject({ id: VoiceProfileIdSchema }),
    Deleted,
  ),
  /** Starts speaking a sample sentence with a profile. Returns at once. */
  "voices.preview": method(
    z.strictObject({ id: VoiceProfileIdSchema }),
    VoicePreviewSchema,
  ),
  "voices.previewStatus": method(Empty, VoicePreviewSchema),
  "doctor.exports": method(Empty, z.array(DoctorExportSchema)),
  /** Queues an inspection. The video itself is only ever read. */
  "doctor.inspect": method(InspectRequestSchema, InspectionSchema),
  "doctor.list": method(Empty, z.array(InspectionSchema)),
  "doctor.get": method(z.strictObject({ id: IdSchema }), InspectionSchema),
  /** Removes the report and its evidence pictures; never the video. */
  "doctor.delete": method(z.strictObject({ id: IdSchema }), Deleted),
  "visualReferences.list": method(
    z.strictObject({ projectId: IdSchema }),
    z.array(VisualReferenceSchema),
  ),
  "visualReferences.save": method(
    VisualReferenceSaveSchema,
    VisualReferenceSchema,
  ),
  /** Also unlinks it from every scene. Its pictures are not deleted here. */
  "visualReferences.delete": method(z.strictObject({ id: IdSchema }), Deleted),

  "llm.status": method(Empty, LocalLlmStatusSchema),
  /** A short real run of a model, recorded as its inference check. */
  "llm.test": method(
    z.strictObject({ modelId: z.string().min(1).max(80) }),
    z.object({
      ok: z.boolean(),
      detail: z.string(),
      durationMs: z.number(),
      residentBytes: z.number().nullable(),
      runtime: z.string(),
    }),
  ),
  "llm.unload": method(Empty, LocalLlmStatusSchema),

  // Story Architect: a concept from an analysis, developed into a draft.
  "story.create": method(
    z.strictObject({ analysisId: IdSchema, itemId: z.string().min(1).max(80) }),
    StoryDraftSchema,
  ),
  "story.list": method(
    z.strictObject({ researchProjectId: IdSchema }),
    z.array(StoryDraftSummarySchema),
  ),
  "story.get": method(z.strictObject({ id: IdSchema }), StoryDraftSchema),
  /** Saves edits. `baseRevision` must be the revision they were made on. */
  "story.save": method(
    z.strictObject({
      id: IdSchema,
      baseRevision: z.number().int().nonnegative(),
      draft: StoryEditableSchema,
    }),
    StoryDraftSchema,
  ),
  /** Queues generation with the local language model. */
  "story.generate": method(
    z.strictObject({
      id: IdSchema,
      modelId: z.string().min(1).max(80),
      scope: StoryScopeSchema,
    }),
    StoryDraftSchema,
  ),
  "story.cancel": method(z.strictObject({ id: IdSchema }), StoryDraftSchema),
  "story.delete": method(z.strictObject({ id: IdSchema }), Deleted),
  /**
   * Creates the production project. `reviewed` records that the user went
   * through the warnings. Asking again returns the project already made.
   */
  "story.createProject": method(
    z.strictObject({
      id: IdSchema,
      baseRevision: z.number().int().nonnegative(),
      reviewed: z.literal(true),
    }),
    z.object({
      draft: StoryDraftSchema,
      projectId: IdSchema,
      episodeId: IdSchema,
      created: z.boolean(),
    }),
  ),
} as const;

export type RpcMethod = keyof typeof rpcContract;
export type RpcParams<M extends RpcMethod> = z.input<
  (typeof rpcContract)[M]["params"]
>;
export type RpcParsedParams<M extends RpcMethod> = z.output<
  (typeof rpcContract)[M]["params"]
>;
export type RpcResult<M extends RpcMethod> = z.output<
  (typeof rpcContract)[M]["result"]
>;

export function isRpcMethod(name: string): name is RpcMethod {
  return Object.hasOwn(rpcContract, name);
}

/** Unsolicited engine -> UI notifications. */
export type CoreEvent =
  | { type: "job.updated"; job: Job }
  | { type: "scene.updated"; scene: Scene; assets: Asset[] }
  | { type: "episode.updated"; episode: Episode; assets: Asset[] }
  | { type: "queue.updated"; queue: QueueStatus }
  | { type: "model.updated"; installation: ModelInstallation }
  | { type: "model.removed"; modelId: string }
  | { type: "log"; entry: LogEntry };

// Line-delimited JSON framing used on the sidecar's stdio.
export interface RpcRequestFrame {
  id: number;
  method: string;
  params?: unknown;
}

export type RpcResponseFrame =
  | { id: number; ok: true; result: unknown }
  | {
      id: number;
      ok: false;
      error: { code: string; message: string; details?: unknown };
    };

export interface RpcEventFrame {
  event: CoreEvent;
}
