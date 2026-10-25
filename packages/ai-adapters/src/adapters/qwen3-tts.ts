/**
 * Qwen3-TTS text-to-speech, through the `mlx-audio` Python package.
 *
 * Like the Kokoro adapter, this one uses an interpreter the user points it
 * at, one where `mlx-audio` is already installed, and runs each narration in
 * a new process with the Hugging Face client in offline mode. It never
 * installs packages and never downloads anything. MLX runs on Apple Silicon
 * only.
 *
 * The engine is not tied to one model or one voice. What a model folder can
 * do is read from its config.json:
 *
 *  - Base models clone a voice from a reference recording and its exact
 *    transcript. Those come from a voice profile (see below).
 *  - VoiceDesign models make up a voice from a written description.
 *  - CustomVoice models speak with one of their preset speakers, optionally
 *    steered by an instruction.
 *
 * Every size (0.6B, 1.7B) and precision (bf16, 8-bit, ...) is the same code
 * path. Models matched to the catalog carry this adapter's runtime id; any
 * other folder whose config.json says it is a Qwen3-TTS model is accepted
 * too, so a variant found in the Hugging Face cache needs no catalog entry.
 *
 * A voice profile is a folder holding a voice.json and its reference
 * recording. voice.json names the voice, says where it comes from
 * (`provenance`, required), gives the recording and its exact transcript,
 * and the synthesis settings that make the voice consistent from one
 * narration to the next: seed, the silence between sentences and between
 * paragraphs, tempo, loudness and output sample rate. The Base model ignores
 * mlx-audio's speed option, so pace comes from those gaps and a
 * pitch-preserving FFmpeg atempo, applied with the loudness filter after
 * synthesis.
 */
import { spawn } from "node:child_process";
import { readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
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
import type { HostPlatform } from "../host/platform";
import { readWavInfo } from "./kokoro";
import { QWEN3_TTS_SCRIPT } from "./qwen3-tts-script";

export const QWEN3_TTS_ID = "qwen3-tts";

/**
 * The runtime this adapter provides: Qwen3-TTS weights converted for MLX,
 * as the mlx-community repositories publish them.
 */
export const QWEN3_TTS_RUNTIME = "qwen3-tts-mlx";

const DETECTION_TTL_MS = 60_000;
const PROFILE_FILE = "voice.json";
/** The one voice a VoiceDesign model offers: the one described. */
const DESIGNED_VOICE = "designed";
const MAX_PROFILES = 200;

/** Language codes of projects, and the names Qwen3-TTS knows them by. */
const LANGUAGES: Record<string, string> = {
  en: "english",
  zh: "chinese",
  de: "german",
  it: "italian",
  pt: "portuguese",
  es: "spanish",
  ja: "japanese",
  ko: "korean",
  fr: "french",
  ru: "russian",
};

/**
 * The preset speakers of the CustomVoice models, as their model card
 * describes them. They can speak every supported language; this is the one
 * each sounds most natural in. A speaker missing here is still offered.
 */
const SPEAKERS: Record<
  string,
  { language: string; gender: "female" | "male" }
> = {
  vivian: { language: "zh", gender: "female" },
  serena: { language: "zh", gender: "female" },
  uncle_fu: { language: "zh", gender: "male" },
  dylan: { language: "zh", gender: "male" },
  eric: { language: "zh", gender: "male" },
  ryan: { language: "en", gender: "male" },
  aiden: { language: "en", gender: "male" },
  ono_anna: { language: "ja", gender: "female" },
  sohee: { language: "ko", gender: "female" },
};

export type Qwen3TtsKind = "base" | "voice_design" | "custom_voice";

/** What a Qwen3-TTS model folder is, from its config.json. */
export interface Qwen3TtsModel {
  kind: Qwen3TtsKind;
  /** "0.6B" or "1.7B", when the config says. */
  size: string | null;
  /** Bits per weight of a quantized model; null for bf16. */
  bits: number | null;
  /** Preset speakers (CustomVoice models), lower case as in the config. */
  speakers: string[];
  /** Languages the model knows by name, e.g. "english". */
  languages: string[];
}

/** How a narration is paced and finished. */
export interface SynthesisSettings {
  seed: number;
  sentenceGapSeconds: number;
  paragraphGapSeconds: number;
  /** Pitch-preserving tempo applied with FFmpeg; 1 leaves it unchanged. */
  tempo: number;
  /** An FFmpeg loudnorm filter, or null to leave loudness unchanged. */
  loudnorm: string | null;
  outputSampleRate: number;
}

/**
 * Used without a voice profile, and for any setting a profile leaves out:
 * the values the series narrator was approved with, at the natural tempo.
 */
export const DEFAULT_SYNTHESIS: SynthesisSettings = {
  seed: 1,
  sentenceGapSeconds: 0.6,
  paragraphGapSeconds: 1.2,
  tempo: 1,
  loudnorm: "loudnorm=I=-16:TP=-1.5:LRA=11",
  outputSampleRate: 48000,
};

export interface VoiceProfile {
  /** The profile's folder name. */
  id: string;
  directory: string;
  name: string;
  /** Where the voice comes from: designed, or recorded with consent. */
  provenance: string;
  referenceAudio: string;
  /** Exactly what is said in the reference recording. */
  transcript: string;
  /** Project language code the profile was made for, when it says. */
  language: string | null;
  gender: "female" | "male" | null;
  settings: SynthesisSettings;
}

export interface Qwen3TtsEnvironment {
  host: Pick<HostPlatform, "os" | "arch">;
  env: NodeJS.ProcessEnv;
  /** The interpreter chosen in settings, or null. */
  python: () => string | null;
  /** The folder of voice profiles chosen in settings, or null. */
  voicesDirectory: () => string | null;
  /** FFmpeg, for tempo, loudness and the output sample rate. */
  ffmpeg: () => string | null;
}

/**
 * Splits narration into paragraphs (at blank lines) and each paragraph into
 * sentences, the unit Qwen3-TTS speaks and progress is counted in. A
 * sentence ends at ".", "!" or "?" followed by a capital letter or a quote,
 * so an ellipsis inside a sentence ("fifteen eighteen... something") stays a
 * pause rather than a break.
 */
export function narrationParagraphs(text: string): string[][] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((paragraph) =>
      paragraph
        .split(/(?<=[.!?…]["”’')\]]*)\s+(?=[\p{Lu}"'“‘(])/u)
        .map((sentence) => sentence.trim())
        .filter(Boolean),
    );
}

/** FFmpeg's atempo takes 0.5 to 2 per filter; others are chained. */
export function atempoFilters(tempo: number): string[] {
  if (Math.abs(tempo - 1) < 1e-6) return [];
  const filters: string[] = [];
  let rest = tempo;
  while (rest < 0.5) {
    filters.push("atempo=0.5");
    rest /= 0.5;
  }
  while (rest > 2) {
    filters.push("atempo=2");
    rest /= 2;
  }
  filters.push(`atempo=${Number(rest.toFixed(6))}`);
  return filters;
}

const SIZES: Record<string, string> = { "0b6": "0.6B", "1b7": "1.7B" };

/**
 * Reads a model folder's config.json. Null when the folder is not a
 * Qwen3-TTS model this adapter knows how to drive.
 */
export async function readQwen3TtsModel(
  directory: string,
): Promise<Qwen3TtsModel | null> {
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(await readFile(join(directory, "config.json"), "utf8"));
  } catch {
    return null;
  }
  const kind = config.tts_model_type;
  if (
    config.model_type !== "qwen3_tts" ||
    (kind !== "base" && kind !== "voice_design" && kind !== "custom_voice")
  ) {
    return null;
  }
  const talker = (config.talker_config ?? {}) as Record<string, unknown>;
  const keys = (value: unknown) =>
    value && typeof value === "object" ? Object.keys(value) : [];
  const quantization = config.quantization as { bits?: unknown } | undefined;
  return {
    kind,
    size: SIZES[String(config.tts_model_size)] ?? null,
    bits: typeof quantization?.bits === "number" ? quantization.bits : null,
    speakers: keys(talker.spk_id).sort(),
    languages: keys(talker.codec_language_id),
  };
}

function modelLabel(model: Qwen3TtsModel): string {
  const kind =
    model.kind === "base"
      ? "Base"
      : model.kind === "voice_design"
        ? "VoiceDesign"
        : "CustomVoice";
  return [
    "Qwen3-TTS",
    model.size,
    kind,
    model.bits ? `${model.bits}-bit` : "bf16",
  ]
    .filter(Boolean)
    .join(" ");
}

function languageName(code: string): string {
  const name = LANGUAGES[code];
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : "Any language";
}

function codeOfLanguage(value: string): string | null {
  const lower = value.trim().toLowerCase();
  const byName = Object.entries(LANGUAGES).find(([, name]) => name === lower);
  if (byName) return byName[0];
  const code = lower.split(/[-_]/)[0] ?? "";
  return code in LANGUAGES ? code : null;
}

// ------------------------------------------------------------ voice profiles

function numberIn(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
  what: string,
): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !(value >= min && value <= max)) {
    throw new Error(`${what} must be a number from ${min} to ${max}.`);
  }
  return value;
}

/** Only loudnorm, with numeric options: a profile cannot add other filters. */
const LOUDNORM =
  /^loudnorm(=[A-Za-z]+=-?\d+(\.\d+)?(:[A-Za-z]+=-?\d+(\.\d+)?)*)?$/;
const SAMPLE_RATES = [16000, 22050, 24000, 32000, 44100, 48000];

function synthesisSettings(raw: unknown): SynthesisSettings {
  const value = (raw ?? {}) as Record<string, unknown>;
  const loudnorm =
    value.loudnorm === undefined ? DEFAULT_SYNTHESIS.loudnorm : value.loudnorm;
  if (
    loudnorm !== null &&
    (typeof loudnorm !== "string" || !LOUDNORM.test(loudnorm))
  ) {
    throw new Error(
      'synthesis.loudnorm must be an FFmpeg loudnorm filter such as "loudnorm=I=-16:TP=-1.5:LRA=11", or null.',
    );
  }
  const rate =
    value.output_sample_rate === undefined
      ? DEFAULT_SYNTHESIS.outputSampleRate
      : value.output_sample_rate;
  if (typeof rate !== "number" || !SAMPLE_RATES.includes(rate)) {
    throw new Error(
      `synthesis.output_sample_rate must be one of ${SAMPLE_RATES.join(", ")}.`,
    );
  }
  const seed = numberIn(
    value.seed,
    0,
    2 ** 32 - 1,
    DEFAULT_SYNTHESIS.seed,
    "synthesis.seed",
  );
  if (!Number.isInteger(seed))
    throw new Error("synthesis.seed must be a whole number.");
  return {
    seed,
    sentenceGapSeconds: numberIn(
      value.sentence_gap_seconds,
      0,
      5,
      DEFAULT_SYNTHESIS.sentenceGapSeconds,
      "synthesis.sentence_gap_seconds",
    ),
    paragraphGapSeconds: numberIn(
      value.paragraph_gap_seconds,
      0,
      10,
      DEFAULT_SYNTHESIS.paragraphGapSeconds,
      "synthesis.paragraph_gap_seconds",
    ),
    tempo: numberIn(
      value.tempo,
      0.5,
      2,
      DEFAULT_SYNTHESIS.tempo,
      "synthesis.tempo",
    ),
    loudnorm,
    outputSampleRate: rate,
  };
}

function text(value: unknown, what: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${what} is missing.`);
  }
  if (value.length > max) throw new Error(`${what} is too long.`);
  return value.trim();
}

/**
 * Reads the voice profile in a folder. Throws an Error saying what is wrong
 * when the folder is not a usable profile.
 */
export async function readVoiceProfile(
  directory: string,
): Promise<VoiceProfile> {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(await readFile(join(directory, PROFILE_FILE), "utf8"));
  } catch {
    throw new Error(`${PROFILE_FILE} is missing or is not valid JSON.`);
  }
  const reference = (raw.reference ?? {}) as Record<string, unknown>;
  const file = text(reference.file, "reference.file", 255);
  // A plain file name next to voice.json, nothing outside the folder.
  if (
    basename(file) !== file ||
    file.startsWith(".") ||
    !/\.wav$/i.test(file)
  ) {
    throw new Error(
      "reference.file must be the name of a WAV file in the profile's folder.",
    );
  }
  const referenceAudio = join(directory, file);
  try {
    const info = readWavInfo(await readFile(referenceAudio));
    if (info.durationSeconds < 1) throw new Error("too short");
  } catch {
    throw new Error(`${file} is missing, is not a WAV file, or is too short.`);
  }
  const synthesis = (raw.synthesis ?? {}) as Record<string, unknown>;
  const gender =
    raw.gender === "female" || raw.gender === "male" ? raw.gender : null;
  return {
    id: basename(directory),
    directory,
    name: text(raw.name, "name", 200),
    provenance: text(
      raw.provenance,
      "provenance (where the voice comes from)",
      2000,
    ),
    referenceAudio,
    transcript: text(reference.transcript, "reference.transcript", 4000),
    language:
      typeof synthesis.language === "string"
        ? codeOfLanguage(synthesis.language)
        : null,
    gender,
    settings: synthesisSettings(synthesis),
  };
}

const PROFILE_ID = /^[\w][\w .-]{0,127}$/;

/**
 * The profiles in the chosen folder: the folder itself when it holds a
 * voice.json, otherwise each folder directly inside it that does. Profiles
 * that cannot be used are returned with the reason.
 */
export async function listVoiceProfiles(root: string): Promise<{
  profiles: VoiceProfile[];
  problems: { id: string; reason: string }[];
}> {
  const profiles: VoiceProfile[] = [];
  const problems: { id: string; reason: string }[] = [];
  const read = async (directory: string) => {
    try {
      profiles.push(await readVoiceProfile(directory));
    } catch (error) {
      problems.push({
        id: basename(directory),
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  };
  if ((await stat(join(root, PROFILE_FILE)).catch(() => null))?.isFile()) {
    await read(root);
    return { profiles, problems };
  }
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries.slice(0, 5000)) {
    // Links are not followed: they could lead anywhere on the disk.
    if (!entry.isDirectory() || !PROFILE_ID.test(entry.name)) continue;
    const directory = join(root, entry.name);
    if (
      !(await stat(join(directory, PROFILE_FILE)).catch(() => null))?.isFile()
    ) {
      continue;
    }
    await read(directory);
    if (profiles.length + problems.length >= MAX_PROFILES) break;
  }
  profiles.sort((a, b) => a.name.localeCompare(b.name));
  return { profiles, problems };
}

function speakerName(id: string): string {
  return id
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

// ------------------------------------------------------------------ adapter

export class Qwen3TtsSpeechAdapter implements AudioGenerationAdapter {
  readonly id = QWEN3_TTS_ID;
  readonly name = "Qwen3-TTS";
  readonly task = "audio_generation";
  readonly isTest = false;
  readonly supportedPlatforms = ["macos"] as const;

  private detection: {
    at: number;
    python: string;
    result: Promise<AdapterAvailability>;
  } | null = null;

  constructor(private readonly environment: Qwen3TtsEnvironment) {}

  private pythonEnv(): NodeJS.ProcessEnv {
    return {
      ...this.environment.env,
      // Never fetch a model, and never write bytecode into someone else's
      // Python installation.
      HF_HUB_OFFLINE: "1",
      TRANSFORMERS_OFFLINE: "1",
      HF_HUB_DISABLE_TELEMETRY: "1",
      PYTHONDONTWRITEBYTECODE: "1",
      PYTHONIOENCODING: "utf-8",
    };
  }

  detect(): Promise<AdapterAvailability> {
    const unavailable = (reason: string, location: string | null = null) =>
      Promise.resolve<AdapterAvailability>({
        available: false,
        reason,
        version: null,
        location,
        installed: false,
      });
    const { host } = this.environment;
    if (host.os !== "macos" || host.arch !== "arm64") {
      return unavailable(
        "Qwen3-TTS runs through MLX, which needs a Mac with Apple Silicon.",
      );
    }
    const python = this.environment.python();
    if (!python) {
      return unavailable(
        "Choose a Python interpreter that has the mlx-audio package installed, in Settings → Engines.",
      );
    }
    if (!this.environment.ffmpeg()) {
      return unavailable(
        "Qwen3-TTS needs FFmpeg to set the narration's tempo, loudness and sample rate.",
        python,
      );
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
        "import mlx.core, numpy, mlx_audio.tts.utils; from importlib.metadata import version; print(version('mlx-audio'))",
      ],
      { timeoutMs: 120_000, env: this.pythonEnv() },
    );
    if (!check.ok) {
      return missing(
        "This Python interpreter cannot import mlx-audio, mlx and numpy. Choose one where the mlx-audio package is installed.",
      );
    }
    return {
      available: true,
      reason: null,
      version: check.stdout.trim().split("\n").pop() || null,
      location: python,
      installed: true,
    };
  }

  async getCapabilities(): Promise<AdapterCapabilities> {
    return {
      maturity: "experimental",
      models: [],
      requiresModel: true,
      parameters: [
        {
          key: "voice",
          label: "Voice",
          type: "string",
          defaultValue: "",
          description:
            "A voice profile for Base models, a preset speaker for CustomVoice models.",
        },
        {
          key: "instruct",
          label: "Voice description",
          type: "string",
          defaultValue: "",
          description:
            "VoiceDesign: the voice to make up, in words. CustomVoice: how to speak. Base models ignore it.",
        },
        {
          key: "speed",
          label: "Speed",
          type: "number",
          defaultValue: 1,
          min: 0.5,
          max: 2,
          step: 0.02,
          description:
            "Multiplies the voice profile's tempo without changing pitch. 1 keeps it.",
        },
        {
          key: "seed",
          label: "Seed",
          type: "integer",
          defaultValue: 0,
          min: 0,
          max: 2 ** 31 - 1,
          step: 1,
          description:
            "The same seed gives the same take. 0 uses the voice profile's own seed.",
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
        "Runs through MLX, on Macs with Apple Silicon only.",
        "Base models speak only with a voice profile: a reference recording, its exact transcript and the settings that keep the voice consistent.",
        'Write years as words (fifteen eighteen); "..." gives a dramatic pause.',
      ],
    };
  }

  async evaluateModel(model: ModelCandidate): Promise<ModelEvaluation> {
    // A catalog model with another runtime is never this engine's; a folder
    // the catalog does not know is, when its config says it is Qwen3-TTS.
    const known = model.runtime === QWEN3_TTS_RUNTIME;
    if (!known && model.runtime !== null) {
      return {
        usable: false,
        kind: "unsupported",
        reason: "Qwen3-TTS speaks with Qwen3-TTS models only.",
      };
    }
    if (!known) {
      const isFolder = (
        await stat(model.location.path).catch(() => null)
      )?.isDirectory();
      if (!isFolder || !(await readQwen3TtsModel(model.location.path))) {
        return {
          usable: false,
          kind: "unsupported",
          reason: "Qwen3-TTS speaks with Qwen3-TTS models only.",
        };
      }
    }
    const availability = await this.detect();
    if (!availability.available) {
      return {
        usable: false,
        kind: "runtime-missing",
        reason: availability.reason ?? "Qwen3-TTS is not set up.",
      };
    }
    return {
      usable: true,
      reason: "Loaded from these files, without network access.",
      reference: model.location.path,
    };
  }

  private async profiles(): Promise<{
    root: string;
    profiles: VoiceProfile[];
    problems: { id: string; reason: string }[];
  }> {
    const root = this.environment.voicesDirectory();
    if (!root) {
      throw new AdapterError(
        "UNAVAILABLE",
        "Base models speak with a voice profile. Choose the folder of voice profiles in Settings → Engines.",
      );
    }
    if (
      !isAbsolute(root) ||
      !(await stat(root).catch(() => null))?.isDirectory()
    ) {
      throw new AdapterError(
        "UNAVAILABLE",
        `The voice profile folder in Settings was not found: ${root}`,
      );
    }
    return { root, ...(await listVoiceProfiles(root)) };
  }

  private async modelAt(path: string): Promise<Qwen3TtsModel> {
    const model = isAbsolute(path) ? await readQwen3TtsModel(path) : null;
    if (!model) {
      throw new AdapterError(
        "INVALID_REQUEST",
        "The chosen model is not a Qwen3-TTS model folder: its config.json is missing or describes another model.",
      );
    }
    return model;
  }

  async listVoices(modelPath: string): Promise<Voice[]> {
    const model = await this.modelAt(modelPath);
    if (model.kind === "voice_design") {
      return [
        {
          id: DESIGNED_VOICE,
          name: "Made from the voice description",
          language: "",
          languageName: "Any language",
          gender: null,
          supported: true,
          reason: null,
        },
      ];
    }
    if (model.kind === "custom_voice") {
      return model.speakers.map((id) => {
        const known = SPEAKERS[id];
        return {
          id,
          name: speakerName(id),
          language: known?.language ?? "",
          languageName: languageName(known?.language ?? ""),
          gender: known?.gender ?? null,
          supported: true,
          reason: null,
        };
      });
    }
    const { root, profiles, problems } = await this.profiles();
    if (profiles.length === 0 && problems.length === 0) {
      throw new AdapterError(
        "UNAVAILABLE",
        `No voice profiles were found in ${root}. A profile is a folder with a ${PROFILE_FILE} and its reference recording.`,
      );
    }
    return [
      ...profiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        language: profile.language ?? "",
        languageName: languageName(profile.language ?? ""),
        gender: profile.gender,
        supported: true,
        reason: null,
      })),
      ...problems.map((problem) => ({
        id: problem.id,
        name: problem.id,
        language: "",
        languageName: "Unusable profile",
        gender: null,
        supported: false,
        reason: problem.reason,
      })),
    ];
  }

  async generate(
    request: AudioGenerationRequest,
    context: ExecutionContext,
  ): Promise<AudioGenerationResult> {
    const python = this.environment.python();
    if (!python) {
      throw new AdapterError(
        "UNAVAILABLE",
        "No Python interpreter is chosen for Qwen3-TTS.",
      );
    }
    const ffmpeg = this.environment.ffmpeg();
    if (!ffmpeg) {
      throw new AdapterError(
        "UNAVAILABLE",
        "Qwen3-TTS needs FFmpeg to finish the narration.",
      );
    }
    if (!request.model || !isAbsolute(request.model)) {
      throw new AdapterError(
        "INVALID_REQUEST",
        "Choose the Qwen3-TTS model to speak with.",
      );
    }
    const modelDir = request.model;
    const model = await this.modelAt(modelDir);

    const code = codeOfLanguage(request.language);
    const language = code ? LANGUAGES[code] : undefined;
    if (
      !language ||
      (model.languages.length > 0 && !model.languages.includes(language))
    ) {
      throw new AdapterError(
        "UNSUPPORTED",
        `Qwen3-TTS does not speak this project's language (${request.language}). It speaks ${(model.languages.length > 0 ? model.languages : Object.values(LANGUAGES)).join(", ")}.`,
      );
    }

    const voice = String(request.parameters.voice ?? "").trim();
    const instruct = String(request.parameters.instruct ?? "").trim();
    let profile: VoiceProfile | null = null;
    let speaker: string | null = null;
    if (model.kind === "base") {
      if (!voice) {
        throw new AdapterError(
          "INVALID_REQUEST",
          "Choose a voice profile: Base models clone the voice in its reference recording.",
        );
      }
      const { profiles, problems } = await this.profiles();
      profile = profiles.find((item) => item.id === voice) ?? null;
      if (!profile) {
        const problem = problems.find((item) => item.id === voice);
        throw new AdapterError(
          "INVALID_REQUEST",
          problem
            ? `The voice profile "${voice}" cannot be used: ${problem.reason}`
            : `There is no voice profile "${voice}" in the chosen folder.`,
        );
      }
    } else if (model.kind === "custom_voice") {
      speaker = model.speakers.find((id) => id === voice.toLowerCase()) ?? null;
      if (!speaker) {
        throw new AdapterError(
          "INVALID_REQUEST",
          `Choose one of this model's speakers: ${model.speakers.map(speakerName).join(", ")}.`,
        );
      }
    } else if (!instruct) {
      throw new AdapterError(
        "INVALID_REQUEST",
        "Describe the voice in the voice description: VoiceDesign models make it up from your words.",
      );
    }

    const paragraphs = narrationParagraphs(request.text);
    const sentences = paragraphs.reduce((sum, p) => sum + p.length, 0);
    if (sentences === 0) {
      throw new AdapterError(
        "INVALID_REQUEST",
        "There is no narration text to speak.",
      );
    }
    const settings = profile?.settings ?? DEFAULT_SYNTHESIS;
    const speed = Number(request.parameters.speed ?? 1);
    const tempo =
      settings.tempo * (Number.isFinite(speed) && speed > 0 ? speed : 1);
    const seedParameter = Math.trunc(Number(request.parameters.seed ?? 0));
    const seed = seedParameter > 0 ? seedParameter : settings.seed;

    const script = join(context.outputDirectory, "qwen3_tts.py");
    const raw = join(context.outputDirectory, "speech-raw.wav");
    const output = join(context.outputDirectory, "narration.wav");
    await writeFile(script, QWEN3_TTS_SCRIPT, "utf8");
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
        failure = message.message ?? "Qwen3-TTS failed.";
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

    context.reportProgress({ fraction: null, message: "Loading the model" });
    child.stdin.end(
      `${JSON.stringify({
        model: modelDir,
        language,
        seed,
        refAudio: profile?.referenceAudio ?? null,
        refText: profile?.transcript ?? null,
        speaker,
        instruct: model.kind === "base" ? null : instruct || null,
        paragraphs,
        sentenceGapSeconds: settings.sentenceGapSeconds,
        paragraphGapSeconds: settings.paragraphGapSeconds,
        output: raw,
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
        `Qwen3-TTS failed: ${failed ?? (stderr.trim().split("\n").slice(-2).join(" | ") || `exit code ${exitCode}`)}`,
      );
    }

    context.reportProgress({
      fraction: null,
      message: "Finishing the narration",
    });
    const filters = [
      ...atempoFilters(tempo),
      ...(settings.loudnorm ? [settings.loudnorm] : []),
    ];
    const finished = await runCommand(
      ffmpeg,
      [
        "-y",
        "-nostdin",
        "-loglevel",
        "error",
        "-i",
        raw,
        ...(filters.length > 0 ? ["-af", filters.join(",")] : []),
        "-ar",
        String(settings.outputSampleRate),
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        output,
      ],
      { timeoutMs: 600_000, signal: context.signal },
    );
    if (context.signal.aborted) {
      throw new AdapterError("CANCELLED", "Speech generation was stopped.");
    }
    await rm(raw, { force: true });
    if (!finished.ok) {
      throw new AdapterError(
        "ENGINE_FAILURE",
        `FFmpeg could not finish the narration: ${finished.stderr.trim().split("\n").slice(-2).join(" | ") || "unknown error"}`,
      );
    }

    // Trust the file, not the report: it must be a real, non-empty WAV.
    let info: ReturnType<typeof readWavInfo>;
    try {
      info = readWavInfo(await readFile(output));
    } catch {
      throw new AdapterError(
        "ENGINE_FAILURE",
        "Qwen3-TTS did not produce a valid WAV file.",
      );
    }
    if (info.durationSeconds <= 0) {
      throw new AdapterError(
        "ENGINE_FAILURE",
        "Qwen3-TTS produced an empty audio file.",
      );
    }
    const voiceLabel =
      profile?.id ??
      speaker ??
      (model.kind === "voice_design" ? DESIGNED_VOICE : voice);
    return {
      artifact: { path: output, kind: "audio" },
      model: `${modelLabel(model)}:${voiceLabel}`,
      details: {
        modelType: model.kind,
        voice: voiceLabel,
        ...(profile
          ? { voiceProfile: profile.name, provenance: profile.provenance }
          : {}),
        ...(instruct && model.kind !== "base" ? { instruct } : {}),
        seed,
        tempo: Math.round(tempo * 1000) / 1000,
        sentences,
        paragraphs: paragraphs.length,
        durationSeconds: Math.round(info.durationSeconds * 1000) / 1000,
        sampleRate: info.sampleRate,
      },
    };
  }
}
