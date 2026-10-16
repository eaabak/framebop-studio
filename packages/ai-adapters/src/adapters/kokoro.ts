/**
 * Kokoro text-to-speech, through the `kokoro` Python package.
 *
 * Framebop Studio does not ship a Python runtime yet. This adapter uses an
 * interpreter the user points it at, one where `kokoro` is already
 * installed, and the PyTorch release of Kokoro-82M: either installed by the
 * model manager or found read-only in the Hugging Face cache. It never
 * installs packages and never downloads anything: the model is loaded from
 * the given files and the Hugging Face client is put in offline mode.
 *
 * Each run is a separate process, so a run can always be stopped and a crash
 * in native code cannot affect the engine.
 */
import { spawn } from "node:child_process";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { createInterface } from "node:readline";
import type { Voice } from "@framebop/core";
import {
  type AdapterAvailability,
  type AdapterCapabilities,
  AdapterError,
  type AudioGenerationAdapter,
  type AudioGenerationRequest,
  type AudioGenerationResult,
  type ExecutionContext,
  type ModelCandidate,
  type ModelEvaluation,
} from "../contracts";
import { runCommand } from "../host/exec";
import { KOKORO_SCRIPT } from "./kokoro-script";

export const KOKORO_ID = "kokoro";

/**
 * The runtime this adapter provides. Registry entries (and models imported
 * from Hugging Face) with this runtime id are Kokoro-82M in its PyTorch
 * release: config.json, kokoro-v1_0.pth and voices/*.pt.
 */
export const KOKORO_RUNTIME = "kokoro-pytorch";
const CONFIG_FILE = "config.json";
const WEIGHTS_FILE = "kokoro-v1_0.pth";
const SENTENCE_GAP_SECONDS = 0.12;
const DETECTION_TTL_MS = 60_000;

/**
 * Kokoro's voice names start with a language letter and a gender letter.
 * English needs only what the `kokoro` package installs; other languages
 * need extra packages that are not checked for yet, so they are listed but
 * not offered.
 */
const LANGUAGES: Record<string, { name: string; supported: boolean }> = {
  a: { name: "American English", supported: true },
  b: { name: "British English", supported: true },
  e: { name: "Spanish", supported: false },
  f: { name: "French", supported: false },
  h: { name: "Hindi", supported: false },
  i: { name: "Italian", supported: false },
  j: { name: "Japanese", supported: false },
  p: { name: "Brazilian Portuguese", supported: false },
  z: { name: "Mandarin Chinese", supported: false },
};

const VOICE_ID = /^[a-z]{2}_[a-z0-9]+$/;

export interface KokoroEnvironment {
  env: NodeJS.ProcessEnv;
  /** The interpreter chosen in settings, or null. */
  python: () => string | null;
}

/** Splits narration into sentences, the unit progress is counted in. */
export function narrationSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  return (
    normalized
      .match(/[^.!?]+(?:[.!?]+["”’')\]]*|$)/g)
      ?.map((sentence) => sentence.trim())
      .filter(Boolean) ?? [normalized]
  );
}

function describeVoice(id: string): Voice {
  const language = LANGUAGES[id[0] ?? ""];
  const gender = id[1] === "f" ? "female" : id[1] === "m" ? "male" : null;
  const given = id.slice(3);
  const name = given.charAt(0).toUpperCase() + given.slice(1);
  return {
    id,
    name,
    language: id[0] ?? "",
    languageName: language?.name ?? "Unknown language",
    gender,
    supported: language?.supported ?? false,
    reason: language?.supported
      ? null
      : `${language?.name ?? "This language"} needs language packages this build does not check for yet.`,
  };
}

/**
 * Parses the header of a PCM WAV file. Throws when it is not one. `data` may
 * be just the start of the file when `totalBytes` gives the file's size.
 */
export function readWavInfo(
  data: Buffer,
  totalBytes: number = data.length,
): {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  durationSeconds: number;
} {
  if (
    data.length < 44 ||
    data.toString("ascii", 0, 4) !== "RIFF" ||
    data.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error("not a WAV file");
  }
  let offset = 12;
  let format: { channels: number; sampleRate: number; bits: number } | null =
    null;
  while (offset + 8 <= data.length) {
    const id = data.toString("ascii", offset, offset + 4);
    const size = data.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      format = {
        channels: data.readUInt16LE(body + 2),
        sampleRate: data.readUInt32LE(body + 4),
        bits: data.readUInt16LE(body + 14),
      };
    } else if (id === "data") {
      if (!format) throw new Error("data before format");
      const frameBytes = format.channels * (format.bits / 8);
      const bytes = Math.min(size, totalBytes - body);
      return {
        sampleRate: format.sampleRate,
        channels: format.channels,
        bitsPerSample: format.bits,
        durationSeconds: bytes / frameBytes / format.sampleRate,
      };
    }
    offset = body + size + (size % 2);
  }
  throw new Error("no audio data");
}

export class KokoroSpeechAdapter implements AudioGenerationAdapter {
  readonly id = KOKORO_ID;
  readonly name = "Kokoro";
  readonly task = "audio_generation";
  readonly isTest = false;
  readonly supportedPlatforms = ["macos", "windows", "linux"] as const;

  private detection: {
    at: number;
    python: string;
    result: Promise<AdapterAvailability>;
  } | null = null;

  constructor(private readonly environment: KokoroEnvironment) {}

  private pythonEnv(): NodeJS.ProcessEnv {
    return {
      ...this.environment.env,
      // Never fetch a model or a voice, and never write bytecode into
      // someone else's Python installation.
      HF_HUB_OFFLINE: "1",
      TRANSFORMERS_OFFLINE: "1",
      PYTHONDONTWRITEBYTECODE: "1",
      PYTHONIOENCODING: "utf-8",
    };
  }

  detect(): Promise<AdapterAvailability> {
    const python = this.environment.python();
    if (!python) {
      return Promise.resolve({
        available: false,
        reason:
          "Choose a Python interpreter that has the kokoro package installed, in Settings → Speech.",
        version: null,
        location: null,
        installed: false,
      });
    }
    const cached = this.detection;
    if (
      cached &&
      cached.python === python &&
      Date.now() - cached.at < DETECTION_TTL_MS
    ) {
      return cached.result;
    }
    const result = this.probe(python);
    this.detection = { at: Date.now(), python, result };
    return result;
  }

  private async probe(python: string): Promise<AdapterAvailability> {
    const missing = (reason: string): AdapterAvailability => ({
      available: false,
      reason,
      version: null,
      location: python,
      installed: false,
    });
    if (
      !isAbsolute(python) ||
      !(await stat(python).catch(() => null))?.isFile()
    ) {
      return missing(
        `The Python interpreter in Settings was not found: ${python}`,
      );
    }
    const check = await runCommand(
      python,
      [
        "-I",
        "-B",
        "-c",
        "import kokoro, misaki.en, torch, numpy; print(kokoro.__version__)",
      ],
      { timeoutMs: 120_000, env: this.pythonEnv() },
    );
    if (!check.ok) {
      return missing(
        "This Python interpreter cannot import kokoro, misaki, torch and numpy. Choose one where the kokoro package is installed.",
      );
    }
    return {
      available: true,
      reason: null,
      version: check.stdout.trim() || null,
      location: python,
      installed: true,
    };
  }

  async getCapabilities(): Promise<AdapterCapabilities> {
    return {
      maturity: "verified",
      models: [],
      requiresModel: true,
      parameters: [
        {
          key: "voice",
          label: "Voice",
          type: "string",
          defaultValue: "af_heart",
          description:
            "One of the voice files that come with the chosen model.",
        },
        {
          key: "speed",
          label: "Speed",
          type: "number",
          defaultValue: 1,
          min: 0.5,
          max: 2,
          step: 0.05,
          description: "1 is Kokoro's natural pace.",
        },
      ],
      resolutions: [],
      requiresPrompt: true,
      requiresInputImage: false,
      supportsCancellation: true,
      reportsProgress: true,
      expensive: false,
      notes: [
        "Uses a Python interpreter you choose; Framebop does not install Python packages.",
        "English voices only in this version.",
        "Runs on the CPU, in a new process each time, so every run first spends a few seconds loading the model.",
      ],
    };
  }

  async evaluateModel(model: ModelCandidate): Promise<ModelEvaluation> {
    // What the model is decides whether this engine can ever run it; whether
    // its runtime is set up decides whether it can now.
    if (model.runtime !== KOKORO_RUNTIME) {
      return {
        usable: false,
        kind: "unsupported",
        reason:
          model.format === "onnx"
            ? "This engine runs the PyTorch release of Kokoro; the ONNX release needs a runtime that is not built yet."
            : "Kokoro speaks with its own Kokoro-82M model only.",
      };
    }
    const availability = await this.detect();
    if (!availability.available) {
      return {
        usable: false,
        kind: "runtime-missing",
        reason: availability.reason ?? "Kokoro is not set up.",
      };
    }
    return {
      usable: true,
      reason: "Loaded from these files, without network access.",
      reference: model.location.path,
    };
  }

  async listVoices(model: string): Promise<Voice[]> {
    const entries = await readdir(join(model, "voices")).catch(() => []);
    return entries
      .filter((entry) => entry.endsWith(".pt"))
      .map((entry) => entry.slice(0, -3))
      .filter((id) => VOICE_ID.test(id))
      .sort()
      .map(describeVoice);
  }

  async generate(
    request: AudioGenerationRequest,
    context: ExecutionContext,
  ): Promise<AudioGenerationResult> {
    const python = this.environment.python();
    if (!python) {
      throw new AdapterError(
        "UNAVAILABLE",
        "No Python interpreter is chosen for Kokoro.",
      );
    }
    if (!request.model || !isAbsolute(request.model)) {
      throw new AdapterError(
        "INVALID_REQUEST",
        "Choose the Kokoro model to speak with.",
      );
    }
    if (!request.language.toLowerCase().startsWith("en")) {
      throw new AdapterError(
        "UNSUPPORTED",
        "This version speaks English only. Set the project's language to English to generate narration.",
      );
    }
    const voiceId = String(request.parameters.voice ?? "af_heart");
    if (!VOICE_ID.test(voiceId)) {
      throw new AdapterError(
        "INVALID_REQUEST",
        `"${voiceId}" is not a voice name.`,
      );
    }
    const voice = describeVoice(voiceId);
    if (!voice.supported) {
      throw new AdapterError(
        "UNSUPPORTED",
        voice.reason ?? "That voice is not supported.",
      );
    }
    const files = {
      config: join(request.model, CONFIG_FILE),
      weights: join(request.model, WEIGHTS_FILE),
      voice: join(request.model, "voices", `${voiceId}.pt`),
    };
    for (const [what, path] of Object.entries(files)) {
      if (!(await stat(path).catch(() => null))?.isFile()) {
        throw new AdapterError(
          "INVALID_REQUEST",
          what === "voice"
            ? `The voice "${voiceId}" is not in the chosen model's folder.`
            : `The chosen Kokoro model is incomplete: ${path} is missing.`,
        );
      }
    }
    const sentences = narrationSentences(request.text);
    if (sentences.length === 0) {
      throw new AdapterError(
        "INVALID_REQUEST",
        "There is no narration text to speak.",
      );
    }
    const speed = Number(request.parameters.speed ?? 1);

    const script = join(context.outputDirectory, "kokoro_tts.py");
    const output = join(context.outputDirectory, "narration.wav");
    await writeFile(script, KOKORO_SCRIPT, "utf8");
    context.signal.throwIfAborted();

    const child = spawn(python, ["-I", "-B", script], {
      cwd: context.outputDirectory,
      env: this.pythonEnv(),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-4000);
    });
    child.stdin.on("error", () => {});

    let failure: string | null = null;
    let done = false;
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      let message: {
        type: string;
        done?: number;
        total?: number;
        message?: string;
      };
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.type === "progress" && message.total) {
        context.reportProgress({
          fraction: (message.done ?? 0) / message.total,
          message: `Spoke sentence ${message.done} of ${message.total}`,
        });
      } else if (message.type === "done") {
        done = true;
      } else if (message.type === "error") {
        failure = message.message ?? "Kokoro failed.";
      }
    });
    const exited = new Promise<number | null>((resolve) => {
      child.on("exit", (code) => resolve(code));
      child.on("error", (error) => {
        failure = error.message;
        resolve(null);
      });
    });
    const onAbort = () => child.kill("SIGKILL");
    context.signal.addEventListener("abort", onAbort, { once: true });

    context.reportProgress({ fraction: null, message: "Loading Kokoro" });
    child.stdin.end(
      `${JSON.stringify({
        ...files,
        lang: voiceId[0],
        voice: files.voice,
        speed: Number.isFinite(speed) ? speed : 1,
        sentences,
        gapSeconds: SENTENCE_GAP_SECONDS,
        output,
      })}\n`,
    );
    const exitCode = await exited;
    context.signal.removeEventListener("abort", onAbort);
    lines.close();

    if (context.signal.aborted) {
      throw new AdapterError("CANCELLED", "Speech generation was stopped.");
    }
    const failed = failure as string | null;
    if (failed || !done || exitCode !== 0) {
      throw new AdapterError(
        "ENGINE_FAILURE",
        `Kokoro failed: ${failed ?? (stderr.trim().split("\n").slice(-2).join(" | ") || `exit code ${exitCode}`)}`,
      );
    }

    // Trust the file, not the report: it must be a real, non-empty WAV.
    let info: ReturnType<typeof readWavInfo>;
    try {
      info = readWavInfo(await readFile(output));
    } catch {
      throw new AdapterError(
        "ENGINE_FAILURE",
        "Kokoro did not write a valid WAV file.",
      );
    }
    if (info.durationSeconds <= 0) {
      throw new AdapterError(
        "ENGINE_FAILURE",
        "Kokoro wrote an empty audio file.",
      );
    }
    return {
      artifact: { path: output, kind: "audio" },
      model: `kokoro-82m:${voiceId}`,
      details: {
        voice: voiceId,
        speed,
        sentences: sentences.length,
        durationSeconds: Math.round(info.durationSeconds * 1000) / 1000,
        sampleRate: info.sampleRate,
      },
    };
  }
}
