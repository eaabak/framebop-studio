/**
 * Framebop's own voice engine: sherpa-onnx's offline text-to-speech
 * program, which Framebop installs, pins and starts itself. No Python and no
 * other application is needed.
 *
 * A "voice pack" is one pinned model for one language: Kokoro for English,
 * Piper voices for the others. The engine offers the packs that are
 * installed as its models; a pack speaks only its own language.
 *
 * Each narration is one run of the program: it loads the pack, speaks and
 * writes a WAV file. The text is one argument (never parsed as an option),
 * progress is the fraction the program prints itself, and stopping ends the
 * process.
 */
import { availableParallelism } from "node:os";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ParameterSpec, Voice } from "@framebop/core";
import {
  type AdapterAvailability,
  type AdapterCapabilities,
  AdapterError,
  type AudioGenerationAdapter,
  type AudioGenerationRequest,
  type AudioGenerationResult,
  type ExecutionContext,
} from "../contracts";
import { runProcess } from "../host/exec";
import { narrationSentences, readWavInfo } from "./kokoro";

export const SHERPA_ONNX_ID = "sherpa-onnx";

/** One installed voice pack, as the engine describes it to the adapter. */
export interface VoicePackDescriptor {
  id: string;
  name: string;
  /** BCP 47 code: "en", "tr", "pt-BR". */
  language: string;
  languageName: string;
  family: "kokoro" | "piper";
  /** The unpacked pack. */
  directory: string;
  /** The ONNX model file, relative to the directory. */
  model: string;
  /** In speaker-id order. */
  voices: { id: string; name: string; gender: "female" | "male" | null }[];
}

export interface SherpaOnnxEnvironment {
  /** The installed TTS program, or null with why it is missing. */
  runtime: () => {
    path: string | null;
    version: string | null;
    reason: string | null;
  };
  /** The voice packs installed now. */
  packs: () => VoicePackDescriptor[];
}

const PARAMETERS: ParameterSpec[] = [
  {
    key: "voice",
    label: "Voice",
    type: "string",
    defaultValue: "",
    description: "One of the chosen pack's voices. Empty uses its first.",
  },
  {
    key: "speed",
    label: "Speed",
    type: "number",
    defaultValue: 1,
    min: 0.5,
    max: 2,
    step: 0.05,
    description: "1 is the voice's natural pace.",
  },
];

/** Whether a pack in `pack` can read text written in `language`. */
export function speaksLanguage(pack: string, language: string): boolean {
  const a = pack.toLowerCase();
  const b = language.toLowerCase();
  return a === b || a.split("-")[0] === b.split("-")[0];
}

/** The last progress fraction ("progress=0.5") in the program's output. */
export function parseSpeechProgress(text: string): number | null {
  let found: number | null = null;
  for (const match of text.matchAll(/progress=([0-9.]+)/g)) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value >= 0 && value <= 1) found = value;
  }
  return found;
}

/** Peaks above this (-1 dBFS) are turned down to it. */
const HEADROOM = 10 ** (-1 / 20);

/**
 * Piper voices come out normalised to full scale, where encoding can push
 * them over. Turns 16-bit PCM down so its peak is at most -1 dBFS; nothing
 * is clipped, only made quieter. Returns null when nothing needed changing.
 */
export function withHeadroom(wav: Buffer): Buffer | null {
  let offset = 12;
  let bits = 0;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") bits = wav.readUInt16LE(body + 14);
    if (id === "data") {
      if (bits !== 16) return null;
      const end = Math.min(body + size, wav.length) & ~1;
      let peak = 0;
      for (let i = body; i < end; i += 2) {
        peak = Math.max(peak, Math.abs(wav.readInt16LE(i)));
      }
      const limit = Math.floor(32767 * HEADROOM);
      if (peak <= limit) return null;
      const gain = limit / peak;
      const out = Buffer.from(wav);
      for (let i = body; i < end; i += 2) {
        out.writeInt16LE(Math.round(wav.readInt16LE(i) * gain), i);
      }
      return out;
    }
    offset = body + size + (size % 2);
  }
  return null;
}

export class SherpaOnnxSpeechAdapter implements AudioGenerationAdapter {
  readonly id = SHERPA_ONNX_ID;
  readonly name = "Framebop voice engine (sherpa-onnx)";
  readonly task = "audio_generation";
  readonly isTest = false;
  // A runtime is pinned for macOS on Apple silicon so far.
  readonly supportedPlatforms = ["macos"] as const;

  constructor(private readonly environment: SherpaOnnxEnvironment) {}

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
      models: this.environment
        .packs()
        .map((pack) => ({ id: pack.id, name: pack.name })),
      requiresModel: true,
      parameters: PARAMETERS,
      resolutions: [],
      requiresPrompt: true,
      requiresInputImage: false,
      outputFormats: ["audio/wav"],
      supportsCancellation: true,
      reportsProgress: true,
      expensive: false,
      notes: [
        "Runs inside Framebop with its own sherpa-onnx; no Python or other application is needed.",
        "Each voice pack speaks one language: Kokoro for English, Piper voices for the others.",
      ],
    };
  }

  async listVoices(model: string): Promise<Voice[]> {
    const pack = this.environment.packs().find((item) => item.id === model);
    return (pack?.voices ?? []).map((voice) => ({
      id: voice.id,
      name: voice.name,
      language: pack?.language ?? "",
      languageName: pack?.languageName ?? "",
      gender: voice.gender,
      supported: true,
      reason: null,
    }));
  }

  async generate(
    request: AudioGenerationRequest,
    context: ExecutionContext,
  ): Promise<AudioGenerationResult> {
    const runtime = this.environment.runtime();
    if (runtime.path === null) {
      throw new AdapterError(
        "UNAVAILABLE",
        runtime.reason ?? "The voice runtime is not installed.",
      );
    }
    const pack = this.environment
      .packs()
      .find((item) => item.id === request.model);
    if (!pack) {
      throw new AdapterError("INVALID_REQUEST", "Choose an installed voice.");
    }
    if (!speaksLanguage(pack.language, request.language)) {
      throw new AdapterError(
        "UNSUPPORTED",
        `This voice speaks ${pack.languageName}, but the project's language is “${request.language}”.`,
      );
    }
    const voiceId = String(request.parameters.voice ?? "");
    const sid = voiceId
      ? pack.voices.findIndex((voice) => voice.id === voiceId)
      : 0;
    if (sid < 0) {
      throw new AdapterError(
        "INVALID_REQUEST",
        `“${voiceId}” is not one of this pack's voices.`,
      );
    }
    // Leading dashes would make the text look like an option.
    const text = narrationSentences(request.text)
      .join(" ")
      .replace(/^[-\s]+/, "");
    if (!text) {
      throw new AdapterError(
        "INVALID_REQUEST",
        "There is no narration text to speak.",
      );
    }
    const speed = Number(request.parameters.speed ?? 1);
    const lengthScale = 1 / (Number.isFinite(speed) && speed > 0 ? speed : 1);

    const directory = pack.directory;
    const output = join(context.outputDirectory, "narration.wav");
    const kind = pack.family === "kokoro" ? "kokoro" : "vits";
    const args = [
      `--${kind}-model=${join(directory, pack.model)}`,
      `--${kind}-tokens=${join(directory, "tokens.txt")}`,
      `--${kind}-data-dir=${join(directory, "espeak-ng-data")}`,
      ...(pack.family === "kokoro"
        ? [`--kokoro-voices=${join(directory, "voices.bin")}`]
        : []),
      `--${kind}-length-scale=${lengthScale}`,
      `--sid=${sid}`,
      `--num-threads=${Math.min(4, availableParallelism())}`,
      `--output-filename=${output}`,
      text,
    ];

    context.reportProgress({
      fraction: null,
      message: "Loading the voice",
      stage: "loading_model",
    });
    context.log("Starting sherpa-onnx", { pack: pack.id, sid });
    let pending = "";
    let result: Awaited<ReturnType<typeof runProcess>>;
    try {
      result = await runProcess(runtime.path, args, {
        signal: context.signal,
        onOutput: (chunk) => {
          pending = (pending + chunk).slice(-2000);
          const fraction = parseSpeechProgress(pending);
          if (fraction !== null) {
            context.reportProgress({
              fraction,
              message: "Speaking",
              stage: "generating",
            });
          }
        },
      });
    } catch (error) {
      throw new AdapterError(
        "UNAVAILABLE",
        `The voice runtime could not be started: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (context.signal.aborted) {
      throw new AdapterError("CANCELLED", "Speech generation was stopped.");
    }
    if (result.exitCode !== 0) {
      const lines = result.outputTail
        .split(/[\r\n]+/)
        .map((line) => line.trim())
        .filter(Boolean);
      throw new AdapterError(
        "ENGINE_FAILURE",
        `The voice engine ended with ${result.exitCode === null ? "a signal" : `exit code ${result.exitCode}`}: ${lines.slice(-2).join(" | ") || "no message"}`,
      );
    }
    // Trust the file, not the report: it must be a real, non-empty WAV.
    let info: ReturnType<typeof readWavInfo>;
    try {
      const audio = await readFile(output);
      info = readWavInfo(audio);
      const quieter = withHeadroom(audio);
      if (quieter) await writeFile(output, quieter);
    } catch {
      throw new AdapterError(
        "ENGINE_FAILURE",
        "The voice engine did not write a valid WAV file.",
      );
    }
    if (info.durationSeconds <= 0) {
      throw new AdapterError(
        "ENGINE_FAILURE",
        "The voice engine wrote an empty audio file.",
      );
    }
    const voice = pack.voices[sid];
    return {
      artifact: { path: output, kind: "audio" },
      model: `${pack.id}:${voice?.id ?? sid}`,
      details: {
        runtimeVersion: runtime.version,
        pack: pack.id,
        voice: voice?.id ?? null,
        speed,
        durationSeconds: Math.round(info.durationSeconds * 1000) / 1000,
        sampleRate: info.sampleRate,
      },
    };
  }
}
