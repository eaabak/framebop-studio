import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import {
  type AdapterRegistry,
  type AudioGenerationAdapter,
  QWEN3_TTS_ID,
  type VoiceProfile,
  listVoiceProfiles,
  readWavInfo,
  runCommand,
} from "@framebop/ai-adapters";
import {
  AppError,
  VOICE_PREVIEW_SENTENCE,
  VOICE_RECORDING_MAX_SECONDS,
  VOICE_RECORDING_MIN_SECONDS,
  VOICE_STYLE_PACING,
  type VoiceLibrary,
  type VoicePacing,
  type VoicePreview,
  type VoiceProfileInfo,
  type VoiceStyle,
  VoiceStyleSchema,
  consentSentence,
  voiceCloneTranscript,
} from "@framebop/core";
import type { EngineContext } from "../context";
import { getSettings, updateSettings } from "./settings";

const PROFILE_FILE = "voice.json";
const REFERENCE_FILE = "reference.wav";
const SAVED_AS = "recorded live from microphone";

/**
 * Cleans a microphone recording into a reference: rumble below 80 Hz off,
 * steady background noise reduced, silence trimmed at both ends (keeping a
 * quarter second), loudness evened out. Free and local, through FFmpeg.
 */
export const CLEANUP_FILTERS = [
  "highpass=f=80",
  "afftdn=nr=12:nf=-50:tn=1",
  "silenceremove=start_periods=1:start_duration=0.05:start_threshold=-45dB:start_silence=0.25",
  "areverse",
  "silenceremove=start_periods=1:start_duration=0.05:start_threshold=-45dB:start_silence=0.25",
  "areverse",
  "loudnorm=I=-18:TP=-2:LRA=11",
].join(",");
const REFERENCE_SAMPLE_RATE = 48000;

/**
 * A sample takes well under a minute. A reference that is not speech, or
 * does not match its transcript, can make the model ramble on instead.
 */
export const PREVIEW_TIMEOUT_MS = 3 * 60_000;

export interface VoiceServiceOptions {
  registry: AdapterRegistry;
  /**
   * The folder of a usable Qwen3-TTS Base model to preview with, or null
   * when there is none.
   */
  baseModel: () => Promise<string | null>;
}

/** Sample peak, and the share of samples at full scale, of 16-bit PCM. */
export function pcmLevels(wav: Buffer): { peak: number; clipped: number } {
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === "data") {
      const start = offset + 8;
      const end = Math.min(wav.length, start + size) & ~1;
      let peak = 0;
      let clipped = 0;
      for (let at = start; at < end; at += 2) {
        const value = Math.abs(wav.readInt16LE(at));
        if (value > peak) peak = value;
        if (value >= 32_700) clipped++;
      }
      const samples = Math.max(1, (end - start) / 2);
      return { peak: peak / 32_768, clipped: clipped / samples };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error("no audio data");
}

/** A folder name from the speaker's name and the style. */
export function profileIdFor(speaker: string, style: VoiceStyle): string {
  const slug = speaker
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${slug || "voice"}-${style}`;
}

async function isFile(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null))?.isFile() ?? false;
}

async function isDirectory(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null))?.isDirectory() ?? false;
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

/**
 * Voice profiles for the Qwen3-TTS engine: listing them, making one from
 * the user's own live recording, changing a profile's pace, and speaking a
 * sample with one.
 */
export class VoiceService {
  private preview: VoicePreview = {
    state: "idle",
    profileId: null,
    audio: null,
    error: null,
  };

  constructor(
    private readonly ctx: EngineContext,
    private readonly options: VoiceServiceOptions,
    private readonly previewTimeoutMs = PREVIEW_TIMEOUT_MS,
  ) {}

  private ffmpeg(): string {
    const tool = this.ctx.tools.ffmpeg;
    if (!tool.available || !tool.path) {
      throw new AppError(
        "UNAVAILABLE",
        "FFmpeg is needed to clean up the recording. Install FFmpeg, then try again.",
      );
    }
    return tool.path;
  }

  private chosenFolder(): string | null {
    return getSettings(this.ctx).qwenVoicesDirectory;
  }

  async list(): Promise<VoiceLibrary> {
    const directory = this.chosenFolder();
    if (
      !directory ||
      !isAbsolute(directory) ||
      !(await isDirectory(directory))
    ) {
      return { directory, profiles: [], problems: [] };
    }
    const { profiles, problems } = await listVoiceProfiles(directory);
    return {
      directory,
      profiles: await Promise.all(
        profiles.map((profile) => this.info(profile)),
      ),
      problems,
    };
  }

  private async info(profile: VoiceProfile): Promise<VoiceProfileInfo> {
    const raw = await readJson(join(profile.directory, PROFILE_FILE)).catch(
      () => ({}) as Record<string, unknown>,
    );
    const consent = (raw.consent ?? null) as Record<string, unknown> | null;
    const ownRecording =
      consent?.own_voice === true && typeof consent.speaker === "string";
    const style = VoiceStyleSchema.safeParse(raw.style);
    let referenceSeconds = 0;
    try {
      referenceSeconds = readWavInfo(
        await readFile(profile.referenceAudio),
      ).durationSeconds;
    } catch {
      // readVoiceProfile already checked it; a file changed since is shown as 0.
    }
    return {
      id: profile.id,
      name: profile.name,
      ownRecording,
      speaker: ownRecording ? String(consent?.speaker) : null,
      style: style.success ? style.data : null,
      recordedAt:
        ownRecording && typeof consent?.date === "string" ? consent.date : null,
      provenance: profile.provenance,
      referenceSeconds: Math.round(referenceSeconds * 100) / 100,
      pacing: {
        sentenceGapSeconds: profile.settings.sentenceGapSeconds,
        paragraphGapSeconds: profile.settings.paragraphGapSeconds,
        tempo: profile.settings.tempo,
      },
    };
  }

  private async find(id: string): Promise<VoiceProfile> {
    const directory = this.chosenFolder();
    if (!directory || !(await isDirectory(directory))) {
      throw new AppError("NOT_FOUND", "No folder of voice profiles is chosen.");
    }
    const { profiles, problems } = await listVoiceProfiles(directory);
    const profile = profiles.find((item) => item.id === id);
    if (profile) return profile;
    const problem = problems.find((item) => item.id === id);
    throw new AppError(
      problem ? "VALIDATION" : "NOT_FOUND",
      problem
        ? `The voice profile "${id}" cannot be used: ${problem.reason}`
        : `There is no voice profile "${id}".`,
    );
  }

  /**
   * The folder new profiles are saved in. With none chosen, one in the
   * library. When Settings points at a single profile, that profile is
   * copied (never moved) into the library's folder so both stay available.
   */
  private async folderToSaveIn(): Promise<string> {
    const managed = join(this.ctx.paths.dataDir, "voices");
    const chosen = this.chosenFolder();
    if (chosen && isAbsolute(chosen) && (await isDirectory(chosen))) {
      if (!(await isFile(join(chosen, PROFILE_FILE)))) return chosen;
      const { profiles } = await listVoiceProfiles(chosen);
      const single = profiles[0];
      await mkdir(managed, { recursive: true });
      if (single && !(await isDirectory(join(managed, single.id)))) {
        const copy = join(managed, single.id);
        await mkdir(copy);
        await copyFile(join(chosen, PROFILE_FILE), join(copy, PROFILE_FILE));
        await copyFile(
          single.referenceAudio,
          join(copy, basename(single.referenceAudio)),
        );
        this.ctx.log
          .scope("voices")
          .info("Copied the chosen voice profile next to new ones", {
            from: chosen,
            to: copy,
          });
      }
    } else if (chosen) {
      throw new AppError(
        "VALIDATION",
        `The voice profile folder in Settings was not found: ${chosen}. Choose another folder, or clear the setting.`,
      );
    } else {
      await mkdir(managed, { recursive: true });
    }
    if (chosen !== managed) {
      updateSettings(this.ctx, { qwenVoicesDirectory: managed });
    }
    return managed;
  }

  async saveRecording(input: {
    speaker: string;
    style: VoiceStyle;
    ownVoice: true;
    audio: string;
  }): Promise<VoiceProfileInfo> {
    const ffmpeg = this.ffmpeg();
    const recording = Buffer.from(input.audio, "base64");
    let seconds: number;
    let levels: { peak: number; clipped: number };
    try {
      const info = readWavInfo(recording);
      if (info.channels !== 1 || info.bitsPerSample !== 16) {
        throw new Error("format");
      }
      seconds = info.durationSeconds;
      levels = pcmLevels(recording);
    } catch {
      throw new AppError(
        "VALIDATION",
        "The recording is not a 16-bit mono WAV from the recorder.",
      );
    }
    if (seconds < VOICE_RECORDING_MIN_SECONDS) {
      throw new AppError(
        "VALIDATION",
        `The recording is ${Math.round(seconds)} seconds long. Read the whole text, from the first sentence to the last.`,
      );
    }
    if (seconds > VOICE_RECORDING_MAX_SECONDS) {
      throw new AppError(
        "VALIDATION",
        `Recordings can be up to ${VOICE_RECORDING_MAX_SECONDS} seconds long.`,
      );
    }
    if (levels.peak < 0.03) {
      throw new AppError(
        "VALIDATION",
        "The recording is almost silent. Check that the right microphone is selected and not muted, then record again.",
      );
    }
    if (levels.clipped > 0.002) {
      throw new AppError(
        "VALIDATION",
        "The recording is too loud and distorted. Sit a little further from the microphone, or turn its input level down, then record again.",
      );
    }

    const work = await mkdtemp(join(this.ctx.paths.workRoot, "voice-"));
    try {
      const raw = join(work, "recording.wav");
      const cleaned = join(work, REFERENCE_FILE);
      await writeFile(raw, recording);
      const result = await runCommand(
        ffmpeg,
        [
          "-y",
          "-nostdin",
          "-loglevel",
          "error",
          "-i",
          raw,
          "-af",
          CLEANUP_FILTERS,
          "-ar",
          String(REFERENCE_SAMPLE_RATE),
          "-ac",
          "1",
          "-c:a",
          "pcm_s16le",
          cleaned,
        ],
        { timeoutMs: 120_000 },
      );
      if (!result.ok) {
        throw new AppError(
          "INTERNAL",
          `FFmpeg could not clean up the recording: ${result.stderr.trim().split("\n").slice(-2).join(" | ") || "unknown error"}`,
        );
      }
      const reference = await readFile(cleaned).catch(() => null);
      let cleanedSeconds = 0;
      try {
        cleanedSeconds = reference ? readWavInfo(reference).durationSeconds : 0;
      } catch {
        cleanedSeconds = 0;
      }
      if (!reference || cleanedSeconds < VOICE_RECORDING_MIN_SECONDS * 0.6) {
        throw new AppError(
          "VALIDATION",
          "After removing silence and noise, too little speech was left. Record again in a quiet room, close to the microphone.",
        );
      }

      const root = await this.folderToSaveIn();
      const id = await this.freeId(
        root,
        profileIdFor(input.speaker, input.style),
      );
      const recordedAt = this.ctx.now();
      const date = recordedAt.slice(0, 10);
      const speaker = input.speaker.trim();
      const sentence = consentSentence(speaker);
      const pacing = VOICE_STYLE_PACING[input.style];
      const profile = {
        name: `${speaker}: ${input.style}`,
        version: 1,
        approved: date,
        provenance: `The speaker's own voice, ${SAVED_AS} in Framebop Studio on ${date}. ${speaker} confirmed it is their own voice and read this consent sentence aloud at the start of the recording: "${sentence}"`,
        consent: {
          speaker,
          own_voice: true,
          date: recordedAt,
          sentence,
          source: SAVED_AS,
          app: "Framebop Studio",
        },
        style: input.style,
        reference: {
          file: REFERENCE_FILE,
          sha256_prefix: createHash("sha256")
            .update(reference)
            .digest("hex")
            .slice(0, 16),
          transcript: voiceCloneTranscript(speaker),
        },
        cleanup: {
          ffmpeg: CLEANUP_FILTERS,
          recorded_seconds: Math.round(seconds * 100) / 100,
          reference_seconds: Math.round(cleanedSeconds * 100) / 100,
        },
        synthesis: {
          runtime: "mlx-audio (Apple Silicon)",
          language: "english",
          seed: 1,
          unit: "sentence",
          sentence_gap_seconds: pacing.sentenceGapSeconds,
          paragraph_gap_seconds: pacing.paragraphGapSeconds,
          tempo: pacing.tempo,
          loudnorm: "loudnorm=I=-16:TP=-1.5:LRA=11",
          output_sample_rate: 48000,
          notes:
            "Qwen3-TTS Base copies the delivery of the reference recording; record again in another style for another delivery.",
        },
      };
      // Written beside the profile and moved into place, so a profile is
      // never half written. A dot name keeps it out of every listing.
      const staging = join(root, `.${id}.saving-${this.ctx.newId()}`);
      await mkdir(staging);
      await writeFile(
        join(staging, PROFILE_FILE),
        `${JSON.stringify(profile, null, 2)}\n`,
      );
      await copyFile(cleaned, join(staging, REFERENCE_FILE));
      const target = join(root, id);
      const replaced = join(root, `.${id}.replaced-${this.ctx.newId()}`);
      const exists = await isDirectory(target);
      if (exists) await rename(target, replaced);
      await rename(staging, target);
      if (exists) await rm(replaced, { recursive: true, force: true });
      this.ctx.log.scope("voices").info("Saved a recorded voice profile", {
        id,
        style: input.style,
        seconds: profile.cleanup.reference_seconds,
      });
      return this.info(await this.find(id));
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }

  /**
   * The id to save under. Recording the same style again replaces the
   * user's own earlier take; any other profile is never overwritten.
   */
  private async freeId(root: string, wanted: string): Promise<string> {
    for (let n = 1; n < 100; n++) {
      const id = n === 1 ? wanted : `${wanted}-${n}`;
      const path = join(root, id);
      if (!(await stat(path).catch(() => null))) return id;
      const raw = await readJson(join(path, PROFILE_FILE)).catch(() => null);
      const consent = raw?.consent as { own_voice?: unknown } | undefined;
      if (consent?.own_voice === true) return id;
    }
    throw new AppError("CONFLICT", "Too many voice profiles with this name.");
  }

  async updatePacing(
    id: string,
    pacing: VoicePacing,
  ): Promise<VoiceProfileInfo> {
    const profile = await this.find(id);
    const file = join(profile.directory, PROFILE_FILE);
    const raw = await readJson(file);
    raw.synthesis = {
      ...((raw.synthesis ?? {}) as Record<string, unknown>),
      sentence_gap_seconds: pacing.sentenceGapSeconds,
      paragraph_gap_seconds: pacing.paragraphGapSeconds,
      tempo: pacing.tempo,
    };
    await writeFile(file, `${JSON.stringify(raw, null, 2)}\n`);
    return this.info(await this.find(id));
  }

  async remove(id: string): Promise<void> {
    const profile = await this.find(id);
    if (!(await this.info(profile)).ownRecording) {
      throw new AppError(
        "VALIDATION",
        "Only voices you recorded yourself can be deleted here. Remove other profiles in the file manager.",
      );
    }
    await rm(profile.directory, { recursive: true, force: true });
    if (this.preview.profileId === id) this.previewStatus(true);
  }

  previewStatus(reset = false): VoicePreview {
    if (reset) {
      this.preview = {
        state: "idle",
        profileId: null,
        audio: null,
        error: null,
      };
    }
    return this.preview;
  }

  /** Speaks the sample sentence with a profile, in the background. */
  async startPreview(id: string): Promise<VoicePreview> {
    if (this.preview.state === "running") {
      throw new AppError(
        "CONFLICT",
        "A voice sample is already being made. Wait for it to finish.",
      );
    }
    await this.find(id);
    const adapter = this.options.registry.get("audio_generation", QWEN3_TTS_ID);
    if (!adapter) {
      throw new AppError(
        "UNAVAILABLE",
        "The Qwen3-TTS engine is not available.",
      );
    }
    const availability = await adapter.detect();
    if (!availability.available) {
      throw new AppError(
        "UNAVAILABLE",
        availability.reason ?? "Qwen3-TTS is not set up.",
      );
    }
    const model = await this.options.baseModel();
    if (!model) {
      throw new AppError(
        "UNAVAILABLE",
        "No Qwen3-TTS Base model was found. Add the folder that holds it (for example the Hugging Face cache) under Models → Sources.",
      );
    }
    this.preview = {
      state: "running",
      profileId: id,
      audio: null,
      error: null,
    };
    void this.speak(adapter, model, id);
    return this.preview;
  }

  private async speak(
    adapter: AudioGenerationAdapter,
    model: string,
    id: string,
  ): Promise<void> {
    const log = this.ctx.log.scope("voices");
    const output = await mkdtemp(
      join(this.ctx.paths.workRoot, "voice-preview-"),
    );
    const signal = AbortSignal.timeout(this.previewTimeoutMs);
    try {
      const result = await adapter.generate(
        {
          model,
          text: VOICE_PREVIEW_SENTENCE,
          language: "en",
          parameters: { voice: id },
        },
        {
          signal,
          reportProgress: () => {},
          outputDirectory: output,
          attempt: 1,
          log: (message, data) => log.debug(message, data),
        },
      );
      const audio = await readFile(result.artifact.path);
      if (this.preview.profileId === id) {
        this.preview = {
          state: "done",
          profileId: id,
          audio: audio.toString("base64"),
          error: null,
        };
      }
    } catch (error) {
      const message = signal.aborted
        ? "Making the sample took too long. The recording may not match the text: record it again, reading every word as written."
        : error instanceof Error
          ? error.message
          : String(error);
      log.warn("A voice sample could not be made", { id, error: message });
      if (this.preview.profileId === id) {
        this.preview = {
          state: "failed",
          profileId: id,
          audio: null,
          error: message,
        };
      }
    } finally {
      await rm(output, { recursive: true, force: true });
    }
  }
}
