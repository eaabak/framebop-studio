import { chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type AdapterAvailability,
  AdapterRegistry,
  type AudioGenerationAdapter,
  type AudioGenerationRequest,
  type ExecutionContext,
  readVoiceProfile,
} from "@framebop/ai-adapters";
import {
  VOICE_PREVIEW_SENTENCE,
  rpcContract,
  voiceCloneTranscript,
} from "@framebop/core";
import { openLibraryDatabase } from "@framebop/database";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { EngineContext } from "../context";
import { Logger } from "../logger";
import {
  ensureLibraryDirectories,
  resetWorkDirectory,
  resolveLibraryPaths,
} from "../paths";
import { removeTemporaryDirectories, temporaryDirectory } from "../testing";
import { getSettings, updateSettings } from "./settings";
import {
  CLEANUP_FILTERS,
  VoiceService,
  pcmLevels,
  profileIdFor,
} from "./voices";

afterAll(removeTemporaryDirectories);

/** A mono 16-bit WAV of a tone at the given amplitude (0 to 1). */
function tone(seconds: number, amplitude: number, rate = 48000): Buffer {
  const samples = Math.round(rate * seconds);
  const out = Buffer.alloc(44 + samples * 2);
  out.write("RIFF", 0, "ascii");
  out.writeUInt32LE(36 + samples * 2, 4);
  out.write("WAVE", 8, "ascii");
  out.write("fmt ", 12, "ascii");
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36, "ascii");
  out.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const value = amplitude * Math.sin((2 * Math.PI * 220 * i) / rate);
    out.writeInt16LE(
      Math.max(-32768, Math.min(32767, Math.round(value * 32767))),
      44 + i * 2,
    );
  }
  return out;
}

/** Records its arguments and copies the input to the output, as is. */
const FAKE_FFMPEG = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.writeFileSync(process.env.VOICE_FAKE_FFMPEG_RECORD, JSON.stringify(args));
fs.copyFileSync(args[args.indexOf("-i") + 1], args[args.length - 1]);
`;

class FakeQwen implements AudioGenerationAdapter {
  readonly id = "qwen3-tts";
  readonly name = "Qwen3-TTS";
  readonly task = "audio_generation";
  readonly isTest = true;
  readonly supportedPlatforms = ["macos"] as const;
  requests: AudioGenerationRequest[] = [];
  availability: AdapterAvailability = {
    available: true,
    reason: null,
    version: "0.6.0",
    location: null,
    installed: true,
  };
  async detect() {
    return this.availability;
  }
  async getCapabilities() {
    return {} as never;
  }
  async generate(request: AudioGenerationRequest, context: ExecutionContext) {
    this.requests.push(request);
    const path = join(context.outputDirectory, "narration.wav");
    await writeFile(path, tone(1, 0.3));
    return {
      artifact: { path, kind: "audio" as const },
      model: "fake",
      details: {},
    };
  }
}

let dataDir: string;
let ctx: EngineContext;
let qwen: FakeQwen;
let baseModel: string | null;
let service: VoiceService;
let ffmpegRecord: string;

beforeEach(async () => {
  dataDir = await temporaryDirectory("framebop-voices-");
  const paths = resolveLibraryPaths(dataDir);
  await ensureLibraryDirectories(paths);
  await resetWorkDirectory(paths);
  const ffmpeg = join(dataDir, "fake-ffmpeg");
  await writeFile(ffmpeg, FAKE_FFMPEG);
  await chmod(ffmpeg, 0o755);
  ffmpegRecord = join(dataDir, "ffmpeg.json");
  process.env.VOICE_FAKE_FFMPEG_RECORD = ffmpegRecord;
  let tick = 0;
  ctx = {
    db: openLibraryDatabase(paths.databasePath),
    paths,
    log: new Logger(),
    host: { os: "macos", arch: "arm64" } as EngineContext["host"],
    env: {},
    tools: {
      ffmpeg: { available: true, path: ffmpeg, version: "7" },
      ffprobe: { available: false, path: null, version: null },
    },
    emit: () => {},
    now: () => "2026-10-21T12:00:00.000Z",
    newId: () => `id${++tick}`,
  };
  qwen = new FakeQwen();
  baseModel = "/models/qwen3-tts-base";
  service = new VoiceService(ctx, {
    registry: new AdapterRegistry().register(qwen),
    baseModel: async () => baseModel,
  });
});

const save = (
  audio: Buffer,
  style: "calm" | "lively" | "mysterious" = "calm",
) =>
  service.saveRecording({
    speaker: "Şükrü Darius",
    style,
    ownVoice: true,
    audio: audio.toString("base64"),
  });

describe("voice recordings", () => {
  it("cleans a recording into a profile with consent, in the library", async () => {
    const info = await save(tone(30, 0.5));
    expect(rpcContract["voices.saveRecording"].result.parse(info)).toBeTruthy();
    expect(info).toMatchObject({
      id: "sukru-darius-calm",
      name: "Şükrü Darius: calm",
      ownRecording: true,
      speaker: "Şükrü Darius",
      style: "calm",
      recordedAt: "2026-10-21T12:00:00.000Z",
      pacing: { sentenceGapSeconds: 0.6, paragraphGapSeconds: 1.2, tempo: 1 },
    });
    expect(info.referenceSeconds).toBeCloseTo(30);

    // The folder is the library's, and Settings now points at it.
    const root = join(dataDir, "voices");
    expect(getSettings(ctx).qwenVoicesDirectory).toBe(root);
    const args = JSON.parse(await readFile(ffmpegRecord, "utf8"));
    expect(args).toContain(CLEANUP_FILTERS);
    expect(args.slice(-7)).toEqual([
      "-ar",
      "48000",
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      args.at(-1),
    ]);

    // The speech engine reads it as is: transcript, provenance and consent.
    const profile = await readVoiceProfile(join(root, info.id));
    expect(profile.transcript).toBe(voiceCloneTranscript("Şükrü Darius"));
    expect(profile.transcript).toMatch(
      /^My name is Şükrü Darius, I am recording my own voice for Framebop Studio, and I agree to its use\. Long ago/,
    );
    expect(profile.provenance).toContain("recorded live from microphone");
    expect(profile.provenance).toContain("2026-10-21");
    const raw = JSON.parse(
      await readFile(join(root, info.id, "voice.json"), "utf8"),
    );
    expect(raw.consent).toMatchObject({
      speaker: "Şükrü Darius",
      own_voice: true,
      source: "recorded live from microphone",
    });
    // Nothing half written is left behind.
    expect((await readdir(root)).sort()).toEqual(["sukru-darius-calm"]);
  });

  it("gives each style its own profile and replaces a retake of the same style", async () => {
    await save(tone(30, 0.5));
    const lively = await save(tone(20, 0.5), "lively");
    expect(lively.pacing.sentenceGapSeconds).toBe(0.4);
    const retake = await save(tone(25, 0.5));
    expect(retake.id).toBe("sukru-darius-calm");
    expect(retake.referenceSeconds).toBeCloseTo(25);
    const library = await service.list();
    expect(rpcContract["voices.list"].result.parse(library)).toBeTruthy();
    expect(library.profiles.map((p) => p.id)).toEqual([
      "sukru-darius-calm",
      "sukru-darius-lively",
    ]);
  });

  it("refuses silent, distorted, short and non-recorder audio", async () => {
    await expect(save(tone(30, 0.01))).rejects.toThrow(/almost silent/);
    await expect(save(tone(30, 1.2))).rejects.toThrow(/too loud/);
    await expect(save(tone(5, 0.5))).rejects.toThrow(/5 seconds long/);
    await expect(
      service.saveRecording({
        speaker: "Me",
        style: "calm",
        ownVoice: true,
        audio: Buffer.from("ID3 an mp3 file").toString("base64"),
      }),
    ).rejects.toThrow(/16-bit mono WAV/);
  });

  it("only accepts a recording the user confirmed as their own voice", () => {
    const params = rpcContract["voices.saveRecording"].params;
    const base = { speaker: "Me", style: "calm", audio: "A".repeat(100) };
    expect(params.safeParse({ ...base, ownVoice: true }).success).toBe(true);
    expect(params.safeParse({ ...base, ownVoice: false }).success).toBe(false);
    expect(params.safeParse(base).success).toBe(false);
    // No file paths: the recorder's audio is the only input.
    expect(
      params.safeParse({ ...base, ownVoice: true, sourcePath: "/x.wav" })
        .success,
    ).toBe(false);
    expect(
      params.safeParse({ ...base, ownVoice: true, speaker: "<b>" }).success,
    ).toBe(false);
  });

  it("copies a single chosen profile next to new ones instead of hiding it", async () => {
    const narrator = join(dataDir, "narrator");
    await mkdir(narrator);
    await writeFile(join(narrator, "reference.wav"), tone(3, 0.3));
    await writeFile(
      join(narrator, "voice.json"),
      JSON.stringify({
        name: "Narrator",
        provenance: "Designed.",
        reference: { file: "reference.wav", transcript: "Hello there." },
      }),
    );
    updateSettings(ctx, { qwenVoicesDirectory: narrator });
    await save(tone(30, 0.5));
    const library = await service.list();
    expect(library.directory).toBe(join(dataDir, "voices"));
    expect(library.profiles.map((p) => [p.id, p.ownRecording])).toEqual([
      ["narrator", false],
      ["sukru-darius-calm", true],
    ]);
    // The original is untouched and still readable.
    expect((await readVoiceProfile(narrator)).name).toBe("Narrator");
    // Designed voices can be paced, but not deleted, from here.
    const paced = await service.updatePacing("narrator", {
      sentenceGapSeconds: 0.9,
      paragraphGapSeconds: 2,
      tempo: 0.9,
    });
    expect(paced.pacing).toEqual({
      sentenceGapSeconds: 0.9,
      paragraphGapSeconds: 2,
      tempo: 0.9,
    });
    const raw = JSON.parse(
      await readFile(join(dataDir, "voices", "narrator", "voice.json"), "utf8"),
    );
    expect(raw.synthesis).toMatchObject({
      sentence_gap_seconds: 0.9,
      tempo: 0.9,
    });
    await expect(service.remove("narrator")).rejects.toThrow(
      /Only voices you recorded/,
    );
    await service.remove("sukru-darius-calm");
    expect((await service.list()).profiles.map((p) => p.id)).toEqual([
      "narrator",
    ]);
  });
});

describe("voice preview", () => {
  const settle = async () => {
    for (
      let i = 0;
      i < 100 && service.previewStatus().state === "running";
      i++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return service.previewStatus();
  };

  it("speaks the sample sentence with the profile and the Base model", async () => {
    const { id } = await save(tone(30, 0.5));
    expect((await service.startPreview(id)).state).toBe("running");
    const done = await settle();
    expect(rpcContract["voices.previewStatus"].result.parse(done)).toBeTruthy();
    expect(done.state).toBe("done");
    expect(
      Buffer.from(done.audio ?? "", "base64").toString("ascii", 0, 4),
    ).toBe("RIFF");
    expect(qwen.requests).toEqual([
      {
        model: "/models/qwen3-tts-base",
        text: VOICE_PREVIEW_SENTENCE,
        language: "en",
        parameters: { voice: id },
      },
    ]);
  });

  it("stops a sample that runs too long", async () => {
    const { id } = await save(tone(30, 0.5));
    qwen.generate = (_request, context) =>
      new Promise((_resolve, reject) =>
        context.signal.addEventListener("abort", () =>
          reject(new Error("Speech generation was stopped.")),
        ),
      );
    const slow = new VoiceService(
      ctx,
      {
        registry: new AdapterRegistry().register(qwen),
        baseModel: async () => baseModel,
      },
      50,
    );
    await slow.startPreview(id);
    for (let i = 0; i < 100 && slow.previewStatus().state === "running"; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(slow.previewStatus()).toMatchObject({
      state: "failed",
      error: expect.stringMatching(/took too long/),
    });
  });

  it("says what is missing before starting", async () => {
    const { id } = await save(tone(30, 0.5));
    baseModel = null;
    await expect(service.startPreview(id)).rejects.toThrow(
      /No Qwen3-TTS Base model/,
    );
    qwen.availability = {
      ...qwen.availability,
      available: false,
      reason: "Choose a Python.",
    };
    await expect(service.startPreview(id)).rejects.toThrow(/Choose a Python/);
    await expect(service.startPreview("nobody")).rejects.toThrow(
      /no voice profile/,
    );
    expect(service.previewStatus().state).toBe("idle");
  });
});

describe("helpers", () => {
  it("names profile folders safely", () => {
    expect(profileIdFor("Darius", "calm")).toBe("darius-calm");
    expect(profileIdFor("Iğdır O'Neil", "mysterious")).toBe(
      "igdir-o-neil-mysterious",
    );
    expect(profileIdFor("渡辺", "lively")).toBe("voice-lively");
  });

  it("measures peak and clipping", () => {
    expect(pcmLevels(tone(1, 0.5)).peak).toBeCloseTo(0.5, 2);
    expect(pcmLevels(tone(1, 0.5)).clipped).toBe(0);
    expect(pcmLevels(tone(1, 2)).clipped).toBeGreaterThan(0.3);
  });
});
