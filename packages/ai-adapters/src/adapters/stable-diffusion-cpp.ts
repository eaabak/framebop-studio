/**
 * Framebop's own image engine: stable-diffusion.cpp, run as a command-line
 * program that Framebop installs, pins and starts itself. No other
 * application has to be installed or opened.
 *
 * Each picture is one run of `sd-cli`: it loads the model, samples, writes a
 * PNG and exits, so its memory is returned as soon as the picture is done.
 * Prompts are passed in files, never as arguments, so no text can be read as
 * an option. Progress is the step counter the program prints for itself;
 * stopping ends the process.
 *
 * Only settings checked against the pinned version are offered: size, steps,
 * guidance scale, sampler, seed and a negative prompt.
 *
 * A model is a set of parts (a complete checkpoint, or a diffusion model,
 * VAE and text encoders published apart), each passed with the option its
 * role names. Which file plays which role comes from the catalog, so a new
 * model of a kind sd-cli runs needs no code here.
 *
 * The same program makes clips (`-M vid_gen`): it writes the frames as PNG
 * files, and FFmpeg turns them into an MP4.
 */
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ParameterSpec } from "@framebop/core";
import {
  type AdapterAvailability,
  type AdapterCapabilities,
  AdapterError,
  type ExecutionContext,
  type ImageGenerationAdapter,
  type ImageGenerationRequest,
  type ImageGenerationResult,
  type ModelCandidate,
  type ModelEvaluation,
  type ResolvedModelParts,
  type VideoGenerationAdapter,
  type VideoGenerationRequest,
  type VideoGenerationResult,
} from "../contracts";
import { runCommand, runProcess } from "../host/exec";

export const SD_CPP_ID = "stable-diffusion-cpp";
/** The clip engine has its own id, so it is listed as a video engine. */
export const SD_CPP_VIDEO_ID = "stable-diffusion-cpp-video";
/** The runtime id catalog entries name to be run by this engine. */
export const SD_CPP_RUNTIME = "stable-diffusion.cpp";

const MODEL_FILE = /\.(gguf|safetensors|ckpt)$/i;

/** Samplers of the pinned version, from its `--help`. */
const SAMPLERS = [
  "euler_a",
  "euler",
  "heun",
  "dpm2",
  "dpm++2s_a",
  "dpm++2m",
  "dpm++2mv2",
  "lcm",
];

const PARAMETERS: ParameterSpec[] = [
  {
    key: "steps",
    label: "Steps",
    type: "integer",
    defaultValue: 20,
    min: 1,
    max: 100,
    step: 1,
    description: "Sampling steps. More take longer.",
  },
  {
    key: "cfgScale",
    label: "Guidance scale",
    type: "number",
    defaultValue: 7,
    min: 1,
    max: 20,
    step: 0.5,
    description: "How closely the picture follows the prompt.",
  },
  {
    key: "sampler",
    label: "Sampler",
    type: "enum",
    defaultValue: "euler_a",
    options: SAMPLERS,
  },
];

export interface StableDiffusionCppEnvironment {
  /** The installed `sd-cli`, or null with why it is missing. */
  runtime: () => {
    path: string | null;
    version: string | null;
    reason: string | null;
  };
  /**
   * Which file does what in the installed model at `reference` (its
   * folder). Null when it is not a catalog installation: a single file then
   * runs as a complete checkpoint.
   */
  parts?: (reference: string) => ResolvedModelParts | null;
}

/** The sd-cli option each part is passed with. */
const PART_OPTIONS: Record<
  ResolvedModelParts["parts"][number]["role"],
  string
> = {
  model: "-m",
  "diffusion-model": "--diffusion-model",
  "high-noise-diffusion-model": "--high-noise-diffusion-model",
  vae: "--vae",
  t5xxl: "--t5xxl",
  llm: "--llm",
  clip_l: "--clip_l",
  clip_g: "--clip_g",
  clip_vision: "--clip_vision",
};

/**
 * Whether the engine can run `model` for `tasks`, and what to name it by:
 * the checkpoint file for a one-file model, the installation folder for one
 * made of parts.
 */
async function evaluateParts(
  environment: StableDiffusionCppEnvironment,
  model: ModelCandidate,
  tasks: readonly string[],
  what: string,
  available: () => Promise<AdapterAvailability>,
): Promise<ModelEvaluation> {
  if (model.runtime !== SD_CPP_RUNTIME) {
    return {
      usable: false,
      kind: "unsupported",
      reason: "This engine runs models prepared for stable-diffusion.cpp.",
    };
  }
  // A text encoder or a clip model is not a picture model, and so on.
  if (model.task && !tasks.includes(model.task)) {
    return {
      usable: false,
      kind: "unsupported",
      reason: `This model does not make ${what}.`,
    };
  }
  const availability = await available();
  if (!availability.available) {
    return {
      usable: false,
      kind: "runtime-missing",
      reason: availability.reason ?? "The image runtime is not installed.",
    };
  }
  const resolved = environment.parts?.(model.location.path) ?? null;
  const missing = resolved?.parts.find((part) => part.missing !== null);
  if (missing) {
    return {
      usable: false,
      kind: "runtime-missing",
      reason: `It also needs ${missing.missing}, which is not installed yet.`,
    };
  }
  const [first] = resolved?.parts ?? [];
  // A model not downloaded yet has no file; it is still one this engine
  // runs, and its files are found once they are there.
  const reference = resolved
    ? resolved.parts.length === 1 && first?.role === "model"
      ? (first.path ?? undefined)
      : model.location.path
    : ((await modelFile(model.location.path)) ?? undefined);
  return {
    usable: true,
    reason: "Loaded from files on this computer, without network access.",
    ...(reference ? { reference } : {}),
  };
}

/** The options that load the model named by `reference`. */
async function partArguments(
  environment: StableDiffusionCppEnvironment,
  reference: string | null,
): Promise<string[]> {
  if (!reference) {
    throw new AdapterError("INVALID_REQUEST", "Choose an installed model.");
  }
  const resolved = environment.parts?.(reference) ?? null;
  if (resolved === null) {
    if (
      MODEL_FILE.test(reference) &&
      (await stat(reference).catch(() => null))?.isFile()
    ) {
      return ["-m", reference];
    }
    throw new AdapterError("INVALID_REQUEST", "Choose an installed model.");
  }
  const args: string[] = [];
  for (const part of resolved.parts) {
    if (part.path === null) {
      throw new AdapterError(
        "UNAVAILABLE",
        `${part.missing ?? "A part of this model"} is not installed.`,
      );
    }
    args.push(PART_OPTIONS[part.role], part.path);
  }
  if (args.length === 0) {
    throw new AdapterError(
      "INVALID_REQUEST",
      "This model lists no files to load.",
    );
  }
  return args;
}

/**
 * Steps reported as "12/20" in the program's progress bar: the latest bar
 * whose total `counts` accepts.
 */
export function parseSteps(
  text: string,
  counts: (total: number) => boolean = () => true,
): { done: number; total: number } | null {
  let found: { done: number; total: number } | null = null;
  for (const match of text.matchAll(/\|\s*(\d+)\/(\d+)\s*-/g)) {
    const done = Number(match[1]);
    const total = Number(match[2]);
    if (total > 0 && done <= total && counts(total)) found = { done, total };
  }
  return found;
}

export class StableDiffusionCppImageAdapter implements ImageGenerationAdapter {
  readonly id = SD_CPP_ID;
  readonly name = "Framebop image engine (stable-diffusion.cpp)";
  readonly task = "image_generation";
  readonly isTest = false;
  // A runtime is pinned for macOS on Apple silicon so far.
  readonly supportedPlatforms = ["macos"] as const;

  constructor(private readonly environment: StableDiffusionCppEnvironment) {}

  async detect(): Promise<AdapterAvailability> {
    const runtime = this.environment.runtime();
    return {
      available: runtime.path !== null,
      reason: runtime.path === null ? runtime.reason : null,
      version: runtime.version,
      location: runtime.path,
      installed: runtime.path !== null,
    };
  }

  async getCapabilities(): Promise<AdapterCapabilities> {
    return {
      maturity: "experimental",
      models: [],
      requiresModel: true,
      parameters: PARAMETERS,
      // Stable Diffusion 1.5's sizes near 512 pixels, then the larger
      // ones newer models (FLUX, Z-Image) are made for.
      resolutions: [
        { width: 512, height: 512 },
        { width: 768, height: 512 },
        { width: 512, height: 768 },
        { width: 1024, height: 1024 },
        { width: 1024, height: 576 },
        { width: 576, height: 1024 },
      ],
      requiresPrompt: true,
      requiresInputImage: false,
      acceptsInputImage: false,
      supportsNegativePrompt: true,
      supportsSeed: true,
      outputFormats: ["image/png"],
      supportsCancellation: true,
      reportsProgress: true,
      // A run loads a model of gigabytes and can take minutes on a CPU.
      expensive: true,
      notes: [
        "Runs inside Framebop with its own stable-diffusion.cpp; no other application is needed.",
        "Each picture loads the model again, so the first seconds of a run are loading.",
      ],
    };
  }

  async evaluateModel(model: ModelCandidate): Promise<ModelEvaluation> {
    return evaluateParts(this.environment, model, ["image"], "pictures", () =>
      this.detect(),
    );
  }

  async generate(
    request: ImageGenerationRequest,
    context: ExecutionContext,
  ): Promise<ImageGenerationResult> {
    const runtime = this.environment.runtime();
    if (runtime.path === null) {
      throw new AdapterError(
        "UNAVAILABLE",
        runtime.reason ?? "The image runtime is not installed.",
      );
    }
    const model = await partArguments(this.environment, request.model);
    const steps = Number(request.parameters.steps ?? 20);
    const cfgScale = Number(request.parameters.cfgScale ?? 7);
    const sampler = String(request.parameters.sampler ?? "euler_a");
    if (!SAMPLERS.includes(sampler)) {
      throw new AdapterError(
        "INVALID_REQUEST",
        `Unknown sampler “${sampler}”.`,
      );
    }

    const promptFile = join(context.outputDirectory, "prompt.txt");
    const negativeFile = join(context.outputDirectory, "negative.txt");
    const output = join(context.outputDirectory, "sd.png");
    await writeFile(promptFile, request.prompt);
    await writeFile(negativeFile, request.negativePrompt);
    const args = [
      ...model,
      "--prompt-file",
      promptFile,
      "--negative-prompt-file",
      negativeFile,
      "-W",
      String(request.width),
      "-H",
      String(request.height),
      "--steps",
      String(steps),
      "--cfg-scale",
      String(cfgScale),
      "--sampling-method",
      sampler,
      "-s",
      String(Math.trunc(request.seed)),
      // Flash attention in the diffusion model: on Apple silicon a picture
      // takes about a third of the time, with the same result (SSIM 0.999).
      "--diffusion-fa",
      "-o",
      output,
    ];

    context.log("Starting sd-cli", { model: request.model, steps, sampler });
    const { metal } = await runSdCli(runtime.path, args, context, () => true);
    const written = await stat(output).catch(() => null);
    if (!written?.isFile() || written.size === 0) {
      throw new AdapterError("ENGINE_FAILURE", "sd-cli wrote no picture.");
    }
    return {
      artifact: { path: output, kind: "image" },
      model: request.model,
      details: {
        runtime: SD_CPP_RUNTIME,
        runtimeVersion: runtime.version,
        steps,
        cfgScale,
        sampler,
        metal,
      },
    };
  }
}

/**
 * Runs sd-cli once. Progress is its step counter, reported while `counts`
 * accepts the bar's total (a clip's frame decoder draws bars of its own).
 * Throws an `AdapterError` for a failed start, a stop or a failed run.
 */
async function runSdCli(
  program: string,
  args: string[],
  context: ExecutionContext,
  counts: (total: number) => boolean,
): Promise<{ metal: boolean }> {
  context.reportProgress({
    fraction: null,
    message: "Loading the model",
    stage: "loading_model",
  });
  let pending = "";
  // Whether the GPU was used, as the program says while it loads.
  let metal = false;
  let result: Awaited<ReturnType<typeof runProcess>>;
  try {
    result = await runProcess(program, args, {
      signal: context.signal,
      onOutput: (text) => {
        if (!metal && /ggml_metal|using Metal|MTL/i.test(text)) metal = true;
        // The bar is redrawn with carriage returns; keep only the latest.
        pending = (pending + text).slice(-2000);
        const step = parseSteps(pending, counts);
        if (step) {
          context.reportProgress({
            fraction: step.done / step.total,
            message: `Step ${step.done} of ${step.total}`,
            stage: "generating",
          });
        }
      },
    });
  } catch (error) {
    throw new AdapterError(
      "UNAVAILABLE",
      `The image runtime could not be started: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (context.signal.aborted) {
    throw new AdapterError("CANCELLED", "The generation was stopped.");
  }
  if (result.exitCode !== 0) {
    const lines = result.outputTail
      .split(/[\r\n]+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("|"));
    throw new AdapterError(
      "ENGINE_FAILURE",
      `sd-cli ended with ${result.exitCode === null ? "a signal" : `exit code ${result.exitCode}`}: ${lines.slice(-3).join(" | ") || "no message"}`,
    );
  }
  return { metal };
}

/** The model file a catalog installation or folder holds. */
async function modelFile(path: string): Promise<string | null> {
  if (MODEL_FILE.test(path)) {
    return (await stat(path).catch(() => null))?.isFile() ? path : null;
  }
  const entries = await readdir(path).catch(() => [] as string[]);
  const file = entries.find((entry) => MODEL_FILE.test(entry));
  return file ? join(path, file) : null;
}

// ------------------------------------------------------------------ clips

const MAX_CLIP_SECONDS = 5;

const VIDEO_PARAMETERS: ParameterSpec[] = [
  {
    key: "steps",
    label: "Steps",
    type: "integer",
    defaultValue: 20,
    min: 4,
    max: 50,
    step: 1,
    description: "Sampling steps. More take longer.",
  },
  {
    key: "cfgScale",
    label: "Guidance scale",
    type: "number",
    defaultValue: 5,
    min: 1,
    max: 10,
    step: 0.5,
    description: "How closely the clip follows the prompt.",
  },
  {
    key: "flowShift",
    label: "Flow shift",
    type: "number",
    defaultValue: 0,
    min: 0,
    max: 20,
    step: 0.5,
    description:
      "Noise schedule shift for flow models. 0 leaves it to the model.",
  },
  {
    key: "fps",
    label: "Frames per second",
    type: "integer",
    defaultValue: 24,
    min: 8,
    max: 30,
    step: 1,
    description: "The rate the model was trained at (Wan 2.2 5B: 24).",
  },
];

/**
 * Frames for a clip of about `seconds` at `fps`: video models take 4n + 1,
 * from 5 frames to at most five seconds' worth.
 */
export function clipFrames(seconds: number, fps = 24): number {
  const most = Math.floor((MAX_CLIP_SECONDS * fps) / 4);
  const groups = Math.round((seconds * fps) / 4);
  return Math.min(most, Math.max(1, groups)) * 4 + 1;
}

export interface StableDiffusionCppVideoEnvironment extends StableDiffusionCppEnvironment {
  /** FFmpeg, which turns the frames into an MP4, or null when missing. */
  ffmpeg: () => string | null;
}

export class StableDiffusionCppVideoAdapter implements VideoGenerationAdapter {
  readonly id = SD_CPP_VIDEO_ID;
  readonly name = "Framebop clip engine (stable-diffusion.cpp)";
  readonly task = "video_generation";
  readonly isTest = false;
  readonly supportedPlatforms = ["macos"] as const;

  constructor(
    private readonly environment: StableDiffusionCppVideoEnvironment,
  ) {}

  async detect(): Promise<AdapterAvailability> {
    const runtime = this.environment.runtime();
    const ffmpeg = this.environment.ffmpeg();
    const reason =
      runtime.path === null
        ? (runtime.reason ?? "The image runtime is not installed.")
        : ffmpeg === null
          ? "Clips need FFmpeg to be written as video files."
          : null;
    return {
      available: reason === null,
      reason,
      version: runtime.version,
      location: runtime.path,
      installed: runtime.path !== null,
    };
  }

  async getCapabilities(): Promise<AdapterCapabilities> {
    return {
      maturity: "experimental",
      models: [],
      requiresModel: true,
      parameters: VIDEO_PARAMETERS,
      // 480p sizes; both sides are multiples of 32.
      resolutions: [
        { width: 832, height: 480 },
        { width: 480, height: 832 },
      ],
      requiresPrompt: true,
      requiresInputImage: false,
      acceptsInputImage: true,
      supportsNegativePrompt: true,
      supportsSeed: true,
      maxClipSeconds: MAX_CLIP_SECONDS,
      outputFormats: ["video/mp4"],
      supportsCancellation: true,
      reportsProgress: true,
      expensive: true,
      notes: [
        "Runs inside Framebop with its own stable-diffusion.cpp; no other application is needed.",
        "The scene's picture, when it has one, becomes the first frame. Clips are at most five seconds long.",
        "A clip takes many minutes and most of this computer's memory.",
      ],
    };
  }

  async evaluateModel(model: ModelCandidate): Promise<ModelEvaluation> {
    return evaluateParts(
      this.environment,
      model,
      ["image_to_video", "video"],
      "clips",
      () => this.detect(),
    );
  }

  async generate(
    request: VideoGenerationRequest,
    context: ExecutionContext,
  ): Promise<VideoGenerationResult> {
    const runtime = this.environment.runtime();
    const ffmpeg = this.environment.ffmpeg();
    if (runtime.path === null || ffmpeg === null) {
      throw new AdapterError(
        "UNAVAILABLE",
        (await this.detect()).reason ?? "The clip engine is not available.",
      );
    }
    const model = await partArguments(this.environment, request.model);
    const steps = Number(request.parameters.steps ?? 20);
    const cfgScale = Number(request.parameters.cfgScale ?? 5);
    const flowShift = Number(request.parameters.flowShift ?? 0);
    const fps = Number(request.parameters.fps ?? 24);
    const frames = clipFrames(
      Math.min(MAX_CLIP_SECONDS, request.durationSeconds),
      fps,
    );

    const promptFile = join(context.outputDirectory, "prompt.txt");
    const negativeFile = join(context.outputDirectory, "negative.txt");
    const frameDirectory = join(context.outputDirectory, "frames");
    const output = join(context.outputDirectory, "clip.mp4");
    await mkdir(frameDirectory);
    await writeFile(promptFile, request.prompt);
    await writeFile(negativeFile, request.negativePrompt);
    const args = [
      "-M",
      "vid_gen",
      ...model,
      "--prompt-file",
      promptFile,
      "--negative-prompt-file",
      negativeFile,
      "-W",
      String(request.width),
      "-H",
      String(request.height),
      "--video-frames",
      String(frames),
      "--fps",
      String(fps),
      "--steps",
      String(steps),
      "--cfg-scale",
      String(cfgScale),
      "--sampling-method",
      "euler",
      ...(flowShift > 0 ? ["--flow-shift", String(flowShift)] : []),
      "-s",
      String(Math.trunc(request.seed)),
      "--diffusion-fa",
      ...(request.inputImage
        ? [
            "-i",
            request.inputImage.path,
            // Fill the frame and crop the rest, as the clip check expects.
            "--image-preprocess",
            "target=init,mode=crop-resize,filter=lanczos,antialias=true",
          ]
        : []),
      "--output-begin-idx",
      "0",
      "-o",
      join(frameDirectory, "frame_%03d.png"),
    ];

    context.log("Starting sd-cli for a clip", {
      model: request.model,
      steps,
      frames,
      fromImage: request.inputImage !== null,
    });
    const { metal } = await runSdCli(
      runtime.path,
      args,
      context,
      (total) => total === steps,
    );
    const written = (await readdir(frameDirectory)).filter((name) =>
      /^frame_\d{3}\.png$/.test(name),
    );
    if (written.length === 0) {
      throw new AdapterError("ENGINE_FAILURE", "sd-cli wrote no frames.");
    }

    // Encoding is one opaque step, so no percentage is reported for it.
    context.reportProgress({
      fraction: null,
      message: "Encoding the clip",
      stage: "composing",
    });
    const encoded = await runCommand(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-framerate",
        String(fps),
        "-start_number",
        "0",
        "-i",
        join(frameDirectory, "frame_%03d.png"),
        "-an",
        "-pix_fmt",
        "yuv420p",
        "-map_metadata",
        "-1",
        "-fflags",
        "+bitexact",
        output,
      ],
      { timeoutMs: 300_000, signal: context.signal },
    );
    if (context.signal.aborted) {
      throw new AdapterError("CANCELLED", "The generation was stopped.");
    }
    if (!encoded.ok) {
      throw new AdapterError(
        "ENGINE_FAILURE",
        `FFmpeg could not encode the clip: ${encoded.stderr.trim() || "unknown error"}`,
      );
    }
    return {
      artifact: { path: output, kind: "video" },
      model: request.model,
      details: {
        runtime: SD_CPP_RUNTIME,
        runtimeVersion: runtime.version,
        steps,
        cfgScale,
        frames: written.length,
        fps,
        metal,
      },
    };
  }
}
