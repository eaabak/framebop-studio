/**
 * Contracts every production backend implements.
 *
 * Framebop Studio never talks to a model runtime directly. Each backend
 * (Draw Things, ComfyUI, an MLX runtime, a speech model, a renderer, ...) is
 * wrapped in an adapter. The production engine only knows these interfaces,
 * so a backend can be added, replaced or removed without touching it, and a
 * different backend can be used on each operating system.
 *
 * Two rules hold for every adapter:
 *
 *  1. Describe, do not assume. Callers read `detect()` and
 *     `getCapabilities()` before offering an action. An adapter that cannot
 *     cancel or cannot measure progress says so, and the interface adapts.
 *  2. Report only what is real. Progress is the engine's own measurement or
 *     it is `null`. An adapter must never derive a percentage from elapsed
 *     time or any other estimate.
 */
import type {
  AdapterMaturity,
  ModelPart,
  ModelTask,
  ParameterSpec,
  ParameterValue,
  ProductionTask,
  RenderPlan,
  Voice,
} from "@framebop/core";

export type { AdapterMaturity, ParameterSpec, ParameterValue, ProductionTask };

export type HostOs = "macos" | "windows" | "linux";

export interface AdapterAvailability {
  available: boolean;
  /** Why the adapter cannot run right now. Null when available. */
  reason: string | null;
  version: string | null;
  /** Where the backend was found: a path or a local address. */
  location: string | null;
  /**
   * True when the backend's software exists on this machine even though the
   * adapter cannot use it at the moment, for example an application that is
   * installed but not running.
   */
  installed: boolean;
}

export interface ModelDescriptor {
  /** Identifier in the backend's own namespace, passed back on generation. */
  id: string;
  name: string;
}

export interface Resolution {
  width: number;
  height: number;
}

export interface AdapterCapabilities {
  maturity: AdapterMaturity;
  /** Models to choose from. Empty when the backend decides for itself. */
  models: readonly ModelDescriptor[];
  /** Whether a model must be named (as free text when `models` is empty). */
  requiresModel: boolean;
  parameters: readonly ParameterSpec[];
  /** Output sizes on offer. Empty when there is no fixed list. */
  resolutions: readonly Resolution[];
  requiresPrompt: boolean;
  /** Whether generation starts from a still image supplied by the caller. */
  requiresInputImage: boolean;
  /**
   * Whether a starting image is used when one is given: image-to-image for
   * pictures, image-to-video for clips. Must be true when it is required.
   * Left out: no starting image is accepted.
   */
  acceptsInputImage?: boolean;
  /** Whether `negativePrompt` reaches the model. Left out: it does not. */
  supportsNegativePrompt?: boolean;
  /** Whether `seed` reaches the model. Left out: it does not. */
  supportsSeed?: boolean;
  /** Longest clip the engine makes, when known. Left out: unknown. */
  maxClipSeconds?: number | null;
  /** MIME types of the files the engine writes. */
  outputFormats?: readonly string[];
  supportsCancellation: boolean;
  /** False means progress is unknown until the run ends. */
  reportsProgress: boolean;
  /**
   * True when a run may take minutes and most of the machine's memory. The
   * production engine refuses to start such a run without explicit consent.
   */
  expensive: boolean;
  /** Limitations a person should know before starting a run. */
  notes: readonly string[];
}

export interface ProgressEvent {
  /** 0..1 as measured by the backend, or null when it cannot be measured. */
  fraction: number | null;
  /** What the backend reports it is doing, e.g. "Step 3 of 8". */
  message?: string;
  /**
   * The phase the backend has reached, when it can tell. An adapter that
   * cannot distinguish loading from generating leaves it out.
   */
  stage?: "loading_model" | "generating" | "composing" | "rendering";
}

/** What an adapter is given to do its work. */
export interface ExecutionContext {
  /**
   * Aborts when the user cancels or the application shuts down. An adapter
   * that declares `supportsCancellation` must stop promptly and reject with
   * an `AdapterError` of code "CANCELLED".
   */
  signal: AbortSignal;
  reportProgress(event: ProgressEvent): void;
  /**
   * The only directory the adapter may write to. It exists, is empty, and is
   * removed after the run. Output files must be created inside it.
   */
  outputDirectory: string;
  /** 1 for a first run, 2 for the first retry of the same request, and so on. */
  attempt: number;
  log(message: string, data?: Record<string, unknown>): void;
}

/** A file handed to an adapter as input. */
export interface MediaInput {
  /** Absolute path of a file in the library. Read-only for the adapter. */
  path: string;
  mimeType: string;
  width: number | null;
  height: number | null;
}

/** A file an adapter produced. */
export interface OutputArtifact {
  /** Absolute path inside `ExecutionContext.outputDirectory`. */
  path: string;
  kind: "image" | "video" | "audio";
}

export type AdapterErrorCode =
  | "UNAVAILABLE"
  | "INVALID_REQUEST"
  | "UNSUPPORTED"
  | "CANCELLED"
  | "ENGINE_FAILURE";

export class AdapterError extends Error {
  constructor(
    readonly code: AdapterErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AdapterError";
  }
}

export interface AIAdapter {
  /** Identifies the backend. Shared by its adapters for different tasks. */
  readonly id: string;
  readonly name: string;
  readonly task: ProductionTask;
  /** True for adapters that exist to exercise the application, not to create. */
  readonly isTest: boolean;
  readonly supportedPlatforms: readonly HostOs[];
  detect(): Promise<AdapterAvailability>;
  getCapabilities(): Promise<AdapterCapabilities>;
  /**
   * For adapters that load model files: whether this adapter could run the
   * given model, and if not, why. Adapters that never load model files (the
   * test adapter, or an engine that manages its own models) leave it out.
   */
  evaluateModel?(model: ModelCandidate): Promise<ModelEvaluation>;
  /**
   * Frees what the adapter keeps loaded between runs, such as a model held
   * in memory by a long-lived process. Called after every run; adapters that
   * keep nothing leave it out.
   */
  release?(): Promise<void>;
}

/** A model file, or folder, that an adapter might be able to load. */
export interface ModelCandidate {
  /** Catalog id, when the files are a known catalog model. */
  modelId: string | null;
  name: string;
  family: string | null;
  format: string;
  /** Runtime the files are meant for, e.g. "onnxruntime" or "pytorch". */
  runtime: string | null;
  /**
   * What the catalog says the model does ("image", "image_to_video", ...).
   * Left out or null when it is not a catalog model.
   */
  task?: ModelTask | null;
  location: {
    /** "managed": installed by Framebop. "external": owned by something else, read-only. */
    ownership: "managed" | "external";
    path: string;
  };
  /** Whether the files were verified against their published hashes. */
  verified: boolean;
}

/** Which file does what in an installed model, as the engine resolved it. */
export interface ResolvedModelParts {
  modelId: string;
  parts: {
    role: ModelPart["role"];
    /** Null when the model that provides this part is not installed. */
    path: string | null;
    /** The name of that model, when it is missing. */
    missing: string | null;
  }[];
}

export interface ModelEvaluation {
  usable: boolean;
  /** Why the adapter can or cannot use this model, in one sentence. */
  reason: string;
  /**
   * Why not, when not usable: "runtime-missing" means this adapter could run
   * the model once its runtime (an application, a tool, an interpreter) is
   * set up; "unsupported" means it cannot run this model at all. Defaults to
   * "unsupported".
   */
  kind?: "runtime-missing" | "unsupported";
  /**
   * What the adapter wants as the request's `model` to use this candidate.
   * Defaults to the candidate's path.
   */
  reference?: string;
}

interface GenerationRequest {
  /** Model identifier, or null to let the backend use its own choice. */
  model: string | null;
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  /** Always set, so that every run can be reproduced. */
  seed: number;
  /** Values for the adapter's own `parameters`, already validated. */
  parameters: Readonly<Record<string, ParameterValue>>;
}

interface GenerationResult {
  artifact: OutputArtifact;
  /** Optional measured-output contract, enforced before library adoption. */
  expectedVideo?: {
    width: number;
    height: number;
    fps: number;
    frames: number;
  };
  /** The model that actually ran, when the backend reports it. */
  model: string | null;
  /** Backend-specific facts worth keeping with the job. */
  details?: Record<string, unknown>;
}

export interface ImageGenerationRequest extends GenerationRequest {
  /**
   * The image to start from (image-to-image), only for adapters that accept
   * one. Left out or null for a picture made from text alone.
   */
  inputImage?: MediaInput | null;
}
export type ImageGenerationResult = GenerationResult;

export interface ImageGenerationAdapter extends AIAdapter {
  readonly task: "image_generation";
  generate(
    request: ImageGenerationRequest,
    context: ExecutionContext,
  ): Promise<ImageGenerationResult>;
}

export interface VideoGenerationRequest extends GenerationRequest {
  /** The still to animate. Null for adapters that work from text alone. */
  inputImage: MediaInput | null;
  /** Length the scene is planned to last. Adapters may not honour it exactly. */
  durationSeconds: number;
}
export type VideoGenerationResult = GenerationResult;

export interface VideoGenerationAdapter extends AIAdapter {
  readonly task: "video_generation";
  generate(
    request: VideoGenerationRequest,
    context: ExecutionContext,
  ): Promise<VideoGenerationResult>;
}

export interface AudioGenerationRequest {
  model: string | null;
  text: string;
  language: string;
  parameters: Readonly<Record<string, ParameterValue>>;
}
export type AudioGenerationResult = GenerationResult;

export interface AudioGenerationAdapter extends AIAdapter {
  readonly task: "audio_generation";
  generate(
    request: AudioGenerationRequest,
    context: ExecutionContext,
  ): Promise<AudioGenerationResult>;
  /** The voices available with a model, given by its reference. */
  listVoices?(model: string): Promise<Voice[]>;
}

export interface VideoRenderRequest {
  /** Every frame, sound and caption of the video, decided in advance. */
  plan: RenderPlan;
}
export type VideoRenderResult = GenerationResult;

export interface VideoRenderAdapter extends AIAdapter {
  readonly task: "video_render";
  generate(
    request: VideoRenderRequest,
    context: ExecutionContext,
  ): Promise<VideoRenderResult>;
}

export interface AdapterByTask {
  image_generation: ImageGenerationAdapter;
  video_generation: VideoGenerationAdapter;
  audio_generation: AudioGenerationAdapter;
  video_render: VideoRenderAdapter;
}

export type AnyAdapter = AdapterByTask[ProductionTask];
