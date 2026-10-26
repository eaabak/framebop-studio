import { spawn } from "node:child_process";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import {
  LTX_MAX_SECONDS,
  LTX_VIDEO_ENGINE,
  LTX_VIDEO_SIZES,
  ltxFrameCounts,
} from "@framebop/core";
import {
  AdapterError,
  type AdapterAvailability,
  type AdapterCapabilities,
  type ExecutionContext,
  type ModelCandidate,
  type ModelEvaluation,
  type VideoGenerationAdapter,
  type VideoGenerationRequest,
  type VideoGenerationResult,
} from "../contracts";
import { runCommand } from "../host/exec";
import type { HostPlatform } from "../host/platform";
import { LTX_VIDEO_SCRIPT } from "./ltx-video-script";

export interface LtxVideoEnvironment {
  host: HostPlatform;
  env: NodeJS.ProcessEnv;
  python(): string | null;
  modelDirectory(): string | null;
  textEncoderDirectory(): string | null;
  ffmpeg(): string | null;
}

const PIN = {
  "ltx-core-mlx": "0.18.0",
  "ltx-pipelines-mlx": "0.18.0",
  mlx: "0.32.2",
  "mlx-lm": "0.31.1",
};
const PACK_FILES = [
  "transformer-distilled.safetensors",
  "connector.safetensors",
  "vae_encoder.safetensors",
  "vae_decoder.safetensors",
  "spatial_upscaler_x2_v1_1.safetensors",
  "spatial_upscaler_x2_v1_1_config.json",
  "embedded_config.json",
];
const fileExists = async (path: string) =>
  (await stat(path).catch(() => null))?.isFile() === true;

/** Check format metadata, never infer compatibility from .safetensors alone. */
export async function ltxPackDirectory(path: string): Promise<string | null> {
  const info = await stat(path).catch(() => null);
  if (!info?.isDirectory() && !info?.isFile()) return null;
  const directory = info.isDirectory() ? path : dirname(path);
  try {
    const config = JSON.parse(
      await readFile(join(directory, "config.json"), "utf8"),
    );
    const quant = JSON.parse(
      await readFile(join(directory, "quantize_config.json"), "utf8"),
    );
    if (config.model_version !== "2.3.0" || quant.quantization?.bits !== 4)
      return null;
    if (
      !(
        await Promise.all(
          PACK_FILES.map((name) => fileExists(join(directory, name))),
        )
      ).every(Boolean)
    )
      return null;
    return directory;
  } catch {
    return null;
  }
}

export async function ltxEncoderReady(path: string | null): Promise<boolean> {
  if (!path || !isAbsolute(path)) return false;
  try {
    const config = JSON.parse(
      await readFile(join(path, "config.json"), "utf8"),
    );
    if (config.model_type !== "gemma3" || config.quantization?.bits !== 4)
      return false;
    const index = JSON.parse(
      await readFile(join(path, "model.safetensors.index.json"), "utf8"),
    );
    const shards = [...new Set(Object.values(index.weight_map ?? {}))];
    if (
      !shards.length ||
      shards.some(
        (s) =>
          typeof s !== "string" ||
          s.includes("/") ||
          s.includes("\\") ||
          s.startsWith("."),
      )
    )
      return false;
    // The pinned MLX conversion has a stale upstream five-shard index,
    // while its actual weights are a complete two-shard MLX layout. mlx-lm
    // loads those files directly. Validate the real layout, not that stale list.
    const entries = await readdir(path);
    const weights = entries.filter((name) =>
      /^model-\d+-of-\d+\.safetensors$/.test(name),
    );
    let actual: string[];
    if (entries.includes("model.safetensors")) actual = ["model.safetensors"];
    else {
      const parsed = weights.map((name) =>
        /^model-(\d+)-of-(\d+)\.safetensors$/.exec(name)!,
      );
      const total = Number(parsed[0]?.[2]);
      if (
        !Number.isInteger(total) ||
        total < 1 ||
        total > 100 ||
        weights.length !== total ||
        parsed.some((m) => Number(m[2]) !== total)
      )
        return false;
      const indices = new Set(parsed.map((m) => Number(m[1])));
      if (
        indices.size !== total ||
        !Array.from({ length: total }, (_, i) => i + 1).every((i) =>
          indices.has(i),
        )
      )
        return false;
      actual = weights;
    }
    return (
      await Promise.all(
        ["tokenizer.json", "tokenizer_config.json", ...actual].map((name) =>
          fileExists(join(path, name)),
        ),
      )
    ).every(Boolean);
  } catch {
    return false;
  }
}

export class LtxVideoAdapter implements VideoGenerationAdapter {
  readonly id = LTX_VIDEO_ENGINE;
  readonly name = "LTX-2.3 MLX Q4";
  readonly task = "video_generation";
  readonly isTest = false;
  readonly supportedPlatforms = ["macos"] as const;
  private detection: {
    python: string;
    at: number;
    result: Promise<AdapterAvailability>;
  } | null = null;
  constructor(private readonly environment: LtxVideoEnvironment) {}

  private pythonEnv(): NodeJS.ProcessEnv {
    const {
      HF_TOKEN: _token,
      HUGGING_FACE_HUB_TOKEN: _oldToken,
      ...env
    } = this.environment.env;
    const ffmpeg = this.environment.ffmpeg();
    return {
      ...env,
      PATH: [ffmpeg ? dirname(ffmpeg) : "", env.PATH ?? ""]
        .filter(Boolean)
        .join(":"),
      HF_HUB_OFFLINE: "1",
      TRANSFORMERS_OFFLINE: "1",
      HF_HUB_DISABLE_TELEMETRY: "1",
      DO_NOT_TRACK: "1",
      TOKENIZERS_PARALLELISM: "false",
      PYTHONUNBUFFERED: "1",
    };
  }

  async detect(): Promise<AdapterAvailability> {
    const python = this.environment.python();
    const missing = (reason: string): AdapterAvailability => ({
      available: false,
      reason,
      location: python,
      installed: false,
      version: null,
    });
    if (
      this.environment.host.os !== "macos" ||
      this.environment.host.arch !== "arm64"
    )
      return missing("LTX MLX needs a Mac with Apple Silicon.");
    if (!python || !isAbsolute(python) || !(await fileExists(python)))
      return missing(
        "Choose a Python environment with LTX MLX in Settings → Engines.",
      );
    if (!this.environment.ffmpeg())
      return missing("Install FFmpeg before generating an LTX video.");
    if (!(await ltxEncoderReady(this.environment.textEncoderDirectory())))
      return missing(
        "Install the Gemma 3 12B Q4 encoder in Models, or choose its local folder in Settings.",
      );
    if (
      this.detection?.python === python &&
      Date.now() - this.detection.at < 30_000
    )
      return this.detection.result;
    const result = (async () => {
      const check = await runCommand(
        python,
        [
          "-I",
          "-B",
          "-c",
          "import json; from importlib.metadata import version; print(json.dumps({p:version(p) for p in " +
            JSON.stringify(Object.keys(PIN)) +
            "}))",
        ],
        { env: this.pythonEnv(), timeoutMs: 15_000 },
      );
      try {
        const versions = JSON.parse(check.stdout.trim());
        if (
          !check.ok ||
          Object.entries(PIN).some(([p, v]) => versions[p] !== v)
        )
          throw Error();
        return {
          available: true,
          reason: null,
          location: python,
          installed: true,
          version: "0.18.0",
        };
      } catch {
        return missing(
          "This adapter needs ltx-core-mlx / ltx-pipelines-mlx 0.18.0, MLX 0.32.2 and mlx-lm 0.31.1. See docs/ltx-video.md.",
        );
      }
    })();
    this.detection = { python, at: Date.now(), result };
    return result;
  }

  async getCapabilities(): Promise<AdapterCapabilities> {
    const configured = this.environment.modelDirectory();
    const model =
      configured && isAbsolute(configured)
        ? await ltxPackDirectory(configured)
        : null;
    return {
      maturity: "experimental",
      models: model
        ? [{ id: model, name: "LTX-2.3 distilled Q4 · local files" }]
        : [],
      requiresModel: true,
      parameters: [
        {
          key: "referenceStrength",
          label: "Starting image strength",
          type: "number",
          min: 0,
          max: 1,
          step: 0.05,
          defaultValue: 1,
          description:
            "Strength of the first-frame image anchor. Does not guarantee character identity.",
        },
        {
          key: "timeoutSeconds",
          label: "Optional generation deadline (seconds; 0 = unlimited)",
          type: "integer",
          min: 0,
          max: 1200,
          step: 60,
          defaultValue: 0,
          description:
            "Zero disables the generation deadline. A positive limit stops the model process; encoding may take up to another minute.",
        },
      ],
      resolutions: [...LTX_VIDEO_SIZES],
      requiresPrompt: true,
      requiresInputImage: false,
      acceptsInputImage: true,
      supportsNegativePrompt: false,
      supportsSeed: true,
      maxClipSeconds: LTX_MAX_SECONDS,
      outputFormats: ["video/mp4"],
      supportsCancellation: true,
      reportsProgress: true,
      expensive: true,
      notes: [
        "24 fps, silent MP4, 1–10 seconds. Seven seconds at 1280×704 with a reference image completed on 24 GiB; ten-second clips and 1408×768 remain unverified. Distilled 8+3 steps and low-memory streaming.",
        "A 1024×576 five-second clip took about 6 minutes 39 seconds on an M4 Pro with 24 GiB. This is a recorded run, not a time estimate for every clip.",
        "One starting image anchors the first frame. Character identity and exact actions are not guaranteed.",
        "Models stay local; sustained critical memory pressure stops the generation.",
      ],
    };
  }

  async evaluateModel(candidate: ModelCandidate): Promise<ModelEvaluation> {
    if (
      candidate.runtime !== LTX_VIDEO_ENGINE &&
      candidate.location.ownership !== "external"
    )
      return {
        usable: false,
        reason: "This adapter requires the MLX LTX-2.3 Q4 split pack.",
      };
    if (
      candidate.runtime === LTX_VIDEO_ENGINE &&
      candidate.location.ownership === "managed"
    ) {
      const availability = await this.detect();
      return {
        usable: availability.available,
        reason:
          availability.reason ?? "LTX-2.3 MLX Q4 is supported by this adapter.",
        kind: availability.available ? undefined : "runtime-missing",
      };
    }
    const directory = await ltxPackDirectory(candidate.location.path);
    if (!directory)
      return {
        usable: false,
        reason: "Not a complete LTX-2.3 MLX Q4 split pack.",
      };
    const availability = await this.detect();
    return {
      usable: availability.available,
      reason:
        availability.reason ??
        "Local MLX Q4 pack, with first-frame image conditioning.",
      kind: availability.available ? undefined : "runtime-missing",
      reference: directory,
    };
  }

  async generate(
    request: VideoGenerationRequest,
    context: ExecutionContext,
  ): Promise<VideoGenerationResult> {
    const availability = await this.detect();
    if (!availability.available)
      throw new AdapterError(
        "UNAVAILABLE",
        availability.reason ?? "LTX is unavailable.",
      );
    if (request.negativePrompt)
      throw new AdapterError(
        "UNSUPPORTED",
        "The distilled preset does not accept a negative prompt.",
      );
    if (
      !LTX_VIDEO_SIZES.some(
        (s) => s.width === request.width && s.height === request.height,
      )
    )
      throw new AdapterError(
        "INVALID_REQUEST",
        "Choose a supported LTX output size.",
      );
    let frames: ReturnType<typeof ltxFrameCounts>;
    try {
      frames = ltxFrameCounts(request.durationSeconds);
    } catch (error) {
      throw new AdapterError("INVALID_REQUEST", String(error));
    }
    const model =
      request.model && isAbsolute(request.model)
        ? await ltxPackDirectory(request.model)
        : null;
    if (!model)
      throw new AdapterError(
        "INVALID_REQUEST",
        "Choose a complete local LTX-2.3 MLX Q4 pack.",
      );
    const strength = request.parameters.referenceStrength ?? 1;
    const timeout = request.parameters.timeoutSeconds ?? 0;
    if (
      typeof strength !== "number" ||
      !Number.isFinite(strength) ||
      strength < 0 ||
      strength > 1 ||
      typeof timeout !== "number" ||
      !Number.isInteger(timeout) ||
      (timeout !== 0 && timeout < 60) ||
      timeout > 1200
    )
      throw new AdapterError(
        "INVALID_REQUEST",
        "Invalid LTX reference strength or deadline.",
      );
    const python = this.environment.python()!;
    const script = join(context.outputDirectory, "ltx-video.py");
    const raw = join(context.outputDirectory, "ltx-raw.mp4");
    const output = join(context.outputDirectory, "clip.mp4");
    await writeFile(script, LTX_VIDEO_SCRIPT);
    context.signal.throwIfAborted();
    const details = await this.run(
      python,
      script,
      {
        model,
        textEncoder: this.environment.textEncoderDirectory(),
        prompt: request.prompt,
        width: request.width,
        height: request.height,
        seed: request.seed,
        frames: frames.generatedFrames,
        output: raw,
        inputImage: request.inputImage?.path ?? null,
        referenceStrength: strength,
      },
      timeout * 1000,
      context,
    );
    context.reportProgress({
      fraction: null,
      stage: "composing",
      message: "Encoding the requested clip length",
    });
    const encoded = await runCommand(
      this.environment.ffmpeg()!,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        raw,
        "-frames:v",
        String(frames.outputFrames),
        "-an",
        "-c:v",
        "libx264",
        "-crf",
        "16",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        output,
      ],
      { timeoutMs: 60_000, signal: context.signal, env: this.pythonEnv() },
    );
    if (context.signal.aborted)
      throw new AdapterError("CANCELLED", "LTX generation was stopped.");
    if (!encoded.ok || !(await fileExists(output)))
      throw new AdapterError(
        "ENGINE_FAILURE",
        "FFmpeg could not encode the LTX clip.",
      );
    return {
      artifact: { path: output, kind: "video" },
      model,
      details: {
        ...details,
        runtime: this.id,
        runtimeVersion: "0.18.0",
        fps: 24,
        generatedFrames: frames.generatedFrames,
        outputFrames: frames.outputFrames,
        durationSeconds: frames.actualSeconds,
        lowRam: true,
      },
    };
  }

  private run(
    python: string,
    script: string,
    request: Record<string, unknown>,
    timeoutMs: number,
    context: ExecutionContext,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const child = spawn(python, ["-I", "-B", script], {
        env: this.pythonEnv(),
        detached: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let pending = "",
        errorTail = "",
        failure: string | null = null,
        done: Record<string, unknown> | null = null;
      let reason: "cancelled" | "timeout" | null = null;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const kill = (signal: NodeJS.Signals) => {
        try {
          if (child.pid) process.kill(-child.pid, signal);
        } catch {
          /* Already exited. */
        }
      };
      const stop = (why: "cancelled" | "timeout") => {
        if (reason) return;
        reason = why;
        kill("SIGTERM");
        killTimer = setTimeout(() => kill("SIGKILL"), 5000);
      };
      const abort = () => stop("cancelled");
      context.signal.addEventListener("abort", abort, { once: true });
      if (context.signal.aborted) abort();
      const deadline =
        timeoutMs > 0
          ? setTimeout(() => stop("timeout"), timeoutMs)
          : undefined;
      const cleanup = () => {
        clearTimeout(deadline);
        clearTimeout(killTimer);
        context.signal.removeEventListener("abort", abort);
      };
      child.stderr.on("data", (chunk: Buffer) => {
        errorTail = (errorTail + chunk.toString()).slice(-8000);
      });
      child.stdout.on("data", (chunk: Buffer) => {
        pending += chunk.toString();
        if (pending.length > 128_000) {
          failure = "LTX sent an oversized progress message.";
          kill("SIGTERM");
          return;
        }
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) {
          try {
            const event = JSON.parse(line);
            if (event.type === "error")
              failure = String(event.message).slice(0, 2000);
            else if (event.type === "done")
              done = {
                seconds: event.seconds,
                peakMetalBytes: event.peakMetalBytes,
                peakRssBytes: event.peakRssBytes,
              };
            else if (
              event.type === "phase" &&
              ["loading_model", "composing"].includes(event.stage)
            )
              context.reportProgress({
                fraction: null,
                stage: event.stage,
                message: String(event.message),
              });
            else if (
              event.type === "progress" &&
              Number.isInteger(event.done) &&
              Number.isInteger(event.total) &&
              event.total > 0 &&
              event.done >= 0 &&
              event.done <= event.total
            )
              context.reportProgress({
                fraction: event.done / event.total,
                stage: "generating",
                message: String(event.message),
              });
          } catch {
            /* Non-protocol output is not progress. */
          }
        }
      });
      child.stdin.on("error", () => {});
      child.once("error", (error) => {
        cleanup();
        reject(
          new AdapterError(
            "UNAVAILABLE",
            `Could not start LTX: ${error.message}`,
          ),
        );
      });
      child.once("close", (code) => {
        cleanup();
        kill("SIGKILL");
        if (reason === "cancelled")
          reject(new AdapterError("CANCELLED", "LTX generation was stopped."));
        else if (reason === "timeout")
          reject(
            new AdapterError(
              "ENGINE_FAILURE",
              "LTX reached the generation deadline. No scene media was replaced.",
            ),
          );
        else if (code !== 0 || !done) {
          context.log("LTX process failed", { code, stderr: errorTail });
          reject(
            new AdapterError(
              "ENGINE_FAILURE",
              failure ??
                `LTX exited without a completed output (exit ${code}).`,
            ),
          );
        } else resolve(done);
      });
      child.stdin.end(JSON.stringify(request) + "\n");
    });
  }
}
