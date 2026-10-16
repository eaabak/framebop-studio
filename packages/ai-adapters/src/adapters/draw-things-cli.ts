/**
 * Draw Things through its official command-line tool, `draw-things-cli`.
 *
 * The tool's interface is taken from its published source
 * (drawthingsai/draw-things-community, Apps/DrawThingsCLI). The options used
 * here are:
 *
 *   draw-things-cli generate
 *     --model=<file or name>      --prompt=<text>   --negative-prompt=<text>
 *     --models-dir=<folder>       where to look for the model and the files
 *                                 it depends on; Draw Things' own by default
 *     --width=<px> --height=<px>  --seed=<n>        --steps=<n>
 *     --frames=<n>                frame count, for video-capable models
 *     --image=<path>              the still to start from
 *     --output=<path>             .png for an image; .mov or .mp4 for video
 *     --video-format=h264
 *     --offline                   no network access, never downloads models
 *     --no-download-missing       fail rather than fetch a missing model
 *     --disable-preview
 *
 * Unlike the HTTP API, the tool writes a real video file and is an ordinary
 * process, so a run can be stopped by ending the process.
 *
 * Two things are deliberately not done:
 *
 *  - Its progress bar is not shown as progress. For local generation the
 *    tool computes it from elapsed time against an estimate, which is not a
 *    measurement of the model's work.
 *  - Models are never downloaded. Both flags above are always passed, so a
 *    missing model is an error instead of a multi-gigabyte download.
 */
import { stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import type { ParameterSpec, ProductionTask } from "@framebop/core";
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
  type VideoGenerationAdapter,
  type VideoGenerationRequest,
  type VideoGenerationResult,
} from "../contracts";
import { runCommand, runProcess } from "../host/exec";
import type { HostPlatform } from "../host/platform";
import { locateExecutable } from "../host/tools";

export const DRAW_THINGS_CLI_ID = "draw-things-cli";
const PROGRAM = "draw-things-cli";
/** The tool takes its seed as an unsigned 32-bit integer. */
const MAX_SEED = 0xffff_ffff;

const STEPS: ParameterSpec = {
  key: "steps",
  label: "Sampling steps",
  type: "integer",
  defaultValue: 0,
  min: 0,
  max: 200,
  description: "0 uses the settings Draw Things recommends for the model.",
};

const FRAMES: ParameterSpec = {
  key: "frames",
  label: "Frames",
  type: "integer",
  defaultValue: 0,
  min: 0,
  max: 1000,
  description:
    "0 uses the model’s default. A clip lasts the frame count divided by the model’s frame rate.",
};

const SHARED_NOTES = [
  "Experimental: written from the tool’s published source and not yet confirmed against an installed copy.",
  "Never downloads models. The model must already be in Draw Things’ models folder, or be chosen from a folder added under Models.",
  "Shows no percentage, because the tool estimates its own progress from elapsed time.",
  "Loads the model in a separate process. Quit Draw Things first if memory is tight.",
];

interface Environment {
  host: HostPlatform;
  env: NodeJS.ProcessEnv;
}

async function detect({
  host,
  env,
}: Environment): Promise<AdapterAvailability> {
  const path = await locateExecutable(host, PROGRAM, env);
  if (path === null) {
    return {
      available: false,
      reason:
        "The draw-things-cli tool is not installed. It is a separate download from the Draw Things app.",
      version: null,
      location: null,
      installed: false,
    };
  }
  // Confirm that the binary actually starts before offering it.
  const help = await runCommand(path, ["--help"], { timeoutMs: 10_000 });
  return {
    available: help.ok,
    reason: help.ok
      ? null
      : "draw-things-cli is installed but could not be started.",
    version: null,
    location: path,
    installed: true,
  };
}

function capabilities(task: ProductionTask): AdapterCapabilities {
  const video = task === "video_generation";
  return {
    maturity: "experimental",
    models: [],
    requiresModel: true,
    parameters: video ? [STEPS, FRAMES] : [STEPS],
    // Sizes must be multiples of 64, so exact 1080p is not offered.
    resolutions: [
      { width: 1024, height: 576 },
      { width: 1344, height: 768 },
      { width: 1920, height: 1088 },
    ],
    requiresPrompt: true,
    requiresInputImage: video,
    // Only clips take the starting image (`--image`); pictures are text-only.
    acceptsInputImage: video,
    supportsNegativePrompt: true,
    supportsSeed: true,
    // The tool takes a frame count and the model sets the rate.
    maxClipSeconds: null,
    outputFormats: video ? ["video/mp4"] : ["image/png"],
    supportsCancellation: true,
    reportsProgress: false,
    expensive: true,
    notes: video
      ? [
          ...SHARED_NOTES,
          "Works only with video-capable models. Whether a particular model, such as LTX-2.3, gives usable results has not been tested here.",
        ]
      : SHARED_NOTES,
  };
}

/**
 * Builds one `--name=value` argument. The joined form matters: a value that
 * starts with a dash, such as a prompt beginning "-", can then never be read
 * as another option.
 */
function option(name: string, value: string | number): string {
  return `--${name}=${value}`;
}

async function generate(
  environment: Environment,
  request: ImageGenerationRequest | VideoGenerationRequest,
  context: ExecutionContext,
  video: boolean,
): Promise<{ path: string }> {
  const executable = await locateExecutable(
    environment.host,
    PROGRAM,
    environment.env,
  );
  if (executable === null) {
    throw new AdapterError(
      "UNAVAILABLE",
      "draw-things-cli is no longer installed.",
    );
  }
  if (!request.model) {
    throw new AdapterError("INVALID_REQUEST", "A model name is required.");
  }

  const output = join(
    context.outputDirectory,
    video ? "draw-things.mp4" : "draw-things.png",
  );
  // A path chosen in the model picker names the folder to load from, so the
  // files a model depends on (text encoders, VAE) are found next to it.
  const model = isAbsolute(request.model)
    ? [
        option("models-dir", dirname(request.model)),
        option("model", basename(request.model)),
      ]
    : [option("model", request.model)];
  const args = [
    "generate",
    ...model,
    option("prompt", request.prompt),
    option("width", request.width),
    option("height", request.height),
    option("seed", Math.abs(Math.trunc(request.seed)) % (MAX_SEED + 1)),
    option("output", output),
    "--offline",
    "--no-download-missing",
    "--disable-preview",
  ];
  if (request.negativePrompt)
    args.push(option("negative-prompt", request.negativePrompt));
  const steps = Number(request.parameters.steps ?? 0);
  if (steps > 0) args.push(option("steps", steps));
  if (video) {
    args.push(option("video-format", "h264"));
    const frames = Number(request.parameters.frames ?? 0);
    if (frames > 0) args.push(option("frames", frames));
    const { inputImage } = request as VideoGenerationRequest;
    if (inputImage) args.push(option("image", inputImage.path));
  }

  context.log("Starting draw-things-cli", { model: request.model, video });
  let result: Awaited<ReturnType<typeof runProcess>>;
  try {
    result = await runProcess(executable, args, {
      signal: context.signal,
      env: environment.env,
    });
  } catch (error) {
    throw new AdapterError(
      "UNAVAILABLE",
      `draw-things-cli could not be started: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (context.signal.aborted) {
    throw new AdapterError("CANCELLED", "The generation was stopped.");
  }
  if (result.exitCode !== 0) {
    // The tool redraws a progress line with carriage returns; keep real lines.
    const lines = result.outputTail
      .split(/[\r\n]+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    throw new AdapterError(
      "ENGINE_FAILURE",
      `draw-things-cli ended with ${result.exitCode === null ? "a signal" : `exit code ${result.exitCode}`}: ${lines.slice(-3).join(" | ") || "no message"}`,
    );
  }
  const written = await stat(output).catch(() => null);
  if (!written?.isFile() || written.size === 0) {
    throw new AdapterError(
      "ENGINE_FAILURE",
      "draw-things-cli finished without writing its output file.",
    );
  }
  return { path: output };
}

/**
 * The tool loads Draw Things' own converted model files (.ckpt) from its
 * models folder. Other formats are not something it is known to load.
 */
async function evaluateModel(
  environment: Environment,
  model: ModelCandidate,
): Promise<ModelEvaluation> {
  if (model.format !== "ckpt") {
    return {
      usable: false,
      kind: "unsupported",
      reason: `Draw Things loads its own converted .ckpt files; this one is in ${FORMAT_NAMES[model.format] ?? model.format} format.`,
    };
  }
  const availability = await recentDetection(environment);
  if (!availability.available) {
    return {
      usable: false,
      kind: "runtime-missing",
      reason: availability.reason ?? "draw-things-cli is not available.",
    };
  }
  return {
    usable: true,
    reason:
      "draw-things-cli is given this file and its folder. Experimental: not yet tried with this file.",
    reference: model.location.path,
  };
}

const DETECTION_TTL_MS = 10_000;
const detections = new WeakMap<
  Environment,
  { at: number; result: Promise<AdapterAvailability> }
>();

/**
 * A picker asks about every model file in a folder, often dozens. Starting
 * the tool once per file would be slow, so a recent answer is reused.
 */
function recentDetection(
  environment: Environment,
): Promise<AdapterAvailability> {
  const cached = detections.get(environment);
  if (cached && Date.now() - cached.at < DETECTION_TTL_MS) return cached.result;
  const result = detect(environment);
  detections.set(environment, { at: Date.now(), result });
  return result;
}

const FORMAT_NAMES: Record<string, string> = {
  onnx: "ONNX",
  pytorch: "PyTorch",
  pth: "PyTorch",
  pt: "PyTorch",
  safetensors: "safetensors",
  gguf: "GGUF",
};

const shared = {
  id: DRAW_THINGS_CLI_ID,
  name: "Draw Things CLI",
  isTest: false,
  // The tool is also built for Linux, where it has not been tried at all.
  supportedPlatforms: ["macos", "linux"],
} as const;

export class DrawThingsCliImageAdapter implements ImageGenerationAdapter {
  readonly id = shared.id;
  readonly name = shared.name;
  readonly task = "image_generation";
  readonly isTest = shared.isTest;
  readonly supportedPlatforms = shared.supportedPlatforms;

  constructor(private readonly environment: Environment) {}

  detect(): Promise<AdapterAvailability> {
    return detect(this.environment);
  }

  evaluateModel(model: ModelCandidate): Promise<ModelEvaluation> {
    return evaluateModel(this.environment, model);
  }

  async getCapabilities(): Promise<AdapterCapabilities> {
    return capabilities(this.task);
  }

  async generate(
    request: ImageGenerationRequest,
    context: ExecutionContext,
  ): Promise<ImageGenerationResult> {
    const { path } = await generate(this.environment, request, context, false);
    return { artifact: { path, kind: "image" }, model: request.model };
  }
}

export class DrawThingsCliVideoAdapter implements VideoGenerationAdapter {
  readonly id = shared.id;
  readonly name = shared.name;
  readonly task = "video_generation";
  readonly isTest = shared.isTest;
  readonly supportedPlatforms = shared.supportedPlatforms;

  constructor(private readonly environment: Environment) {}

  detect(): Promise<AdapterAvailability> {
    return detect(this.environment);
  }

  evaluateModel(model: ModelCandidate): Promise<ModelEvaluation> {
    return evaluateModel(this.environment, model);
  }

  async getCapabilities(): Promise<AdapterCapabilities> {
    return capabilities(this.task);
  }

  async generate(
    request: VideoGenerationRequest,
    context: ExecutionContext,
  ): Promise<VideoGenerationResult> {
    const { path } = await generate(this.environment, request, context, true);
    return { artifact: { path, kind: "video" }, model: request.model };
  }
}
