/**
 * A production adapter that involves no AI model.
 *
 * It exists so the whole production workflow (queueing, progress, cancelling,
 * failure, retry, attaching a result to a scene) can be exercised on any
 * machine, in seconds, with no GPU and nothing to download. Its output is an
 * obvious test pattern and it is labelled as a test everywhere it appears.
 *
 * It is deterministic: the same request always produces the same image.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
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
  type VideoGenerationAdapter,
  type VideoGenerationRequest,
  type VideoGenerationResult,
} from "../contracts";
import { runCommand } from "../host/exec";
import { encodePng } from "./png";

export const TEST_ADAPTER_ID = "test-pattern";
const MODEL = { id: "test-pattern-v1", name: "Test pattern" };
/** Test clips are capped so that trying the workflow stays quick. */
const MAX_CLIP_SECONDS = 20;

const PARAMETERS: readonly ParameterSpec[] = [
  {
    key: "steps",
    label: "Steps",
    type: "integer",
    defaultValue: 5,
    min: 1,
    max: 60,
    description: "How many steps the adapter works through before finishing.",
  },
  {
    key: "stepDurationMs",
    label: "Time per step (ms)",
    type: "integer",
    defaultValue: 400,
    min: 0,
    max: 10_000,
    description: "Raise this to have time to try cancelling.",
  },
  {
    key: "outcome",
    label: "Outcome",
    type: "enum",
    defaultValue: "succeed",
    options: ["succeed", "fail", "fail-first-attempt"],
    description:
      "“fail” always fails. “fail-first-attempt” fails once and succeeds when retried, to try out retrying.",
  },
];

const CAPABILITIES: AdapterCapabilities = {
  maturity: "test",
  models: [MODEL],
  requiresModel: false,
  parameters: PARAMETERS,
  resolutions: [
    { width: 1280, height: 720 },
    { width: 1024, height: 576 },
    { width: 1920, height: 1080 },
  ],
  requiresPrompt: false,
  requiresInputImage: false,
  acceptsInputImage: true,
  supportsNegativePrompt: true,
  supportsSeed: true,
  outputFormats: ["image/png"],
  supportsCancellation: true,
  reportsProgress: true,
  expensive: false,
  notes: [
    "Produces a test pattern, not AI output. No model is loaded.",
    "Use it to try the production workflow before running a real engine.",
  ],
};

const AVAILABLE: AdapterAvailability = {
  available: true,
  reason: null,
  version: "1",
  location: null,
  installed: true,
};

function cancelled(): AdapterError {
  return new AdapterError("CANCELLED", "The test run was cancelled.");
}

function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(cancelled());
    const onAbort = () => {
      clearTimeout(timer);
      reject(cancelled());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Small deterministic generator, so a seed always gives the same picture. */
function randomFrom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const BARS = [
  [235, 235, 235],
  [235, 235, 16],
  [16, 235, 235],
  [16, 235, 16],
  [235, 16, 235],
  [235, 16, 16],
  [16, 16, 235],
  [16, 16, 16],
] as const;

/** Draws a gradient, a 64-pixel grid, a seed-placed stripe and colour bars. */
export function renderTestPattern(
  width: number,
  height: number,
  seed: number,
): Uint8Array {
  const random = randomFrom(seed);
  const top = [random() * 90, random() * 90 + 30, random() * 120 + 80];
  const bottom = [random() * 60 + 10, random() * 40 + 10, random() * 60 + 20];
  const stripeOffset = Math.floor(random() * width);
  const barsTop = Math.floor(height * 0.82);
  const pixels = new Uint8Array(width * height * 3);

  for (let y = 0; y < height; y += 1) {
    const blend = y / Math.max(1, height - 1);
    for (let x = 0; x < width; x += 1) {
      let color: readonly number[];
      if (y >= barsTop) {
        color =
          BARS[
            Math.min(BARS.length - 1, Math.floor((x / width) * BARS.length))
          ] ?? BARS[0];
      } else if (x % 64 === 0 || y % 64 === 0) {
        color = [70, 200, 210];
      } else if ((x + y + stripeOffset) % 256 < 24) {
        color = [245, 185, 66];
      } else {
        color = [
          (top[0] ?? 0) * (1 - blend) + (bottom[0] ?? 0) * blend,
          (top[1] ?? 0) * (1 - blend) + (bottom[1] ?? 0) * blend,
          (top[2] ?? 0) * (1 - blend) + (bottom[2] ?? 0) * blend,
        ];
      }
      const offset = (y * width + x) * 3;
      pixels[offset] = color[0] ?? 0;
      pixels[offset + 1] = color[1] ?? 0;
      pixels[offset + 2] = color[2] ?? 0;
    }
  }
  return pixels;
}

/**
 * Works through the requested number of steps, reporting each one as it
 * actually completes, and fails half-way when asked to.
 */
async function workThroughSteps(
  request: ImageGenerationRequest,
  context: ExecutionContext,
): Promise<void> {
  const steps = Number(request.parameters.steps ?? 5);
  const stepDuration = Number(request.parameters.stepDurationMs ?? 400);
  const { outcome } = request.parameters;
  const fails =
    outcome === "fail" ||
    (outcome === "fail-first-attempt" && context.attempt === 1);
  const failAt = fails ? Math.ceil(steps / 2) : null;

  context.reportProgress({
    fraction: null,
    message: "Preparing the pattern",
    stage: "loading_model",
  });
  for (let step = 1; step <= steps; step += 1) {
    await pause(stepDuration, context.signal);
    if (step === failAt) {
      throw new AdapterError(
        "ENGINE_FAILURE",
        `The test adapter was asked to fail, and did so at step ${step} of ${steps}.`,
      );
    }
    context.reportProgress({
      fraction: step / steps,
      message: `Step ${step} of ${steps}`,
      stage: "generating",
    });
  }
}

/**
 * What the run received, kept with the job: the starting image's SHA-256
 * proves which file reached the adapter.
 */
async function received(
  request: ImageGenerationRequest,
): Promise<Record<string, unknown>> {
  return {
    inputImageSha256: request.inputImage
      ? createHash("sha256")
          .update(await readFile(request.inputImage.path))
          .digest("hex")
      : null,
    negativePromptReceived: request.negativePrompt.length > 0,
  };
}

async function writePattern(
  request: ImageGenerationRequest,
  context: ExecutionContext,
  fileName: string,
): Promise<string> {
  const path = join(context.outputDirectory, fileName);
  const pixels = renderTestPattern(request.width, request.height, request.seed);
  await writeFile(path, encodePng(request.width, request.height, pixels));
  return path;
}

const shared = {
  id: TEST_ADAPTER_ID,
  name: "Test pattern",
  isTest: true,
  supportedPlatforms: ["macos", "windows", "linux"],
} as const;

export class TestPatternImageAdapter implements ImageGenerationAdapter {
  readonly id = shared.id;
  readonly name = shared.name;
  readonly task = "image_generation";
  readonly isTest = shared.isTest;
  readonly supportedPlatforms = shared.supportedPlatforms;

  async detect(): Promise<AdapterAvailability> {
    return AVAILABLE;
  }

  async getCapabilities(): Promise<AdapterCapabilities> {
    return CAPABILITIES;
  }

  async generate(
    request: ImageGenerationRequest,
    context: ExecutionContext,
  ): Promise<ImageGenerationResult> {
    await workThroughSteps(request, context);
    const path = await writePattern(request, context, "test-pattern.png");
    return {
      artifact: { path, kind: "image" },
      model: MODEL.id,
      details: await received(request),
    };
  }
}

export class TestPatternVideoAdapter implements VideoGenerationAdapter {
  readonly id = shared.id;
  readonly name = shared.name;
  readonly task = "video_generation";
  readonly isTest = shared.isTest;
  readonly supportedPlatforms = shared.supportedPlatforms;

  /** `ffmpegPath` is asked for each time, so installing FFmpeg is noticed. */
  constructor(private readonly ffmpegPath: () => string | null) {}

  async detect(): Promise<AdapterAvailability> {
    if (this.ffmpegPath() !== null) return AVAILABLE;
    return {
      ...AVAILABLE,
      available: false,
      // Writing a video file needs an encoder; a still image does not.
      reason:
        "Test clips need FFmpeg to encode a video file. Test images work without it.",
    };
  }

  async getCapabilities(): Promise<AdapterCapabilities> {
    return {
      ...CAPABILITIES,
      notes: [
        ...CAPABILITIES.notes,
        `A starting image, when given, becomes the clip's picture with a slow change of brightness. Clips are at most ${MAX_CLIP_SECONDS} seconds long.`,
      ],
      maxClipSeconds: MAX_CLIP_SECONDS,
      outputFormats: ["video/mp4"],
    };
  }

  async generate(
    request: VideoGenerationRequest,
    context: ExecutionContext,
  ): Promise<VideoGenerationResult> {
    const ffmpeg = this.ffmpegPath();
    if (ffmpeg === null) {
      throw new AdapterError("UNAVAILABLE", "FFmpeg is not available.");
    }
    await workThroughSteps(request, context);

    const { width, height, inputImage } = request;
    const frame =
      inputImage?.path ?? (await writePattern(request, context, "frame.png"));
    const path = join(context.outputDirectory, "test-pattern.mp4");
    const seconds = Math.min(
      MAX_CLIP_SECONDS,
      Math.max(0.5, request.durationSeconds),
    );
    // Encoding is one opaque step for us, so no percentage is reported for it.
    context.reportProgress({ fraction: null, message: "Encoding the clip" });
    const encoded = await runCommand(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-loop",
        "1",
        "-framerate",
        "30",
        "-i",
        frame,
        "-t",
        seconds.toFixed(3),
        // A starting image fills the frame as an engine would; the pattern
        // gets a slow hue rotation. Either way it is visibly a moving clip.
        "-vf",
        inputImage
          ? `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},eq=brightness='0.06*sin(2*PI*t/4)':eval=frame,format=yuv420p`
          : "hue=h=40*t,format=yuv420p",
        "-an",
        "-map_metadata",
        "-1",
        "-fflags",
        "+bitexact",
        path,
      ],
      { timeoutMs: 120_000, signal: context.signal },
    );
    if (context.signal.aborted) throw cancelled();
    if (!encoded.ok) {
      throw new AdapterError(
        "ENGINE_FAILURE",
        `FFmpeg could not encode the test clip: ${encoded.stderr.trim() || "unknown error"}`,
      );
    }
    return {
      artifact: { path, kind: "video" },
      model: MODEL.id,
      details: await received(request),
    };
  }
}
