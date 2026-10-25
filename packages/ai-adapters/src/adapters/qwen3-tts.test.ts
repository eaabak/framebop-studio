import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExecutionContext } from "../contracts";
import { readWavInfo } from "./kokoro";
import {
  DEFAULT_SYNTHESIS,
  Qwen3TtsSpeechAdapter,
  type Qwen3TtsEnvironment,
  atempoFilters,
  listVoiceProfiles,
  narrationParagraphs,
  readQwen3TtsModel,
  readVoiceProfile,
} from "./qwen3-tts";

/** A mono 16-bit WAV of silence. */
function wav(sampleRate: number, seconds: number): Buffer {
  const data = Math.round(sampleRate * seconds) * 2;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data, 40);
  return Buffer.concat([header, Buffer.alloc(data)]);
}

/**
 * Stand-in programs. The "python" answers the import check, or reads the
 * request, records it, reports each sentence and writes a 24 kHz WAV. The
 * "ffmpeg" records its arguments and writes a WAV at the rate it was asked
 * for. Neither runs a model.
 */
const FAKE_PYTHON = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args.includes("-c")) { console.log("0.6.0"); process.exit(0); }
const request = JSON.parse(fs.readFileSync(0, "utf8").split("\\n")[0]);
fs.writeFileSync(process.env.QWEN_FAKE_RECORD, JSON.stringify({ args, request, env: { offline: process.env.HF_HUB_OFFLINE } }));
if (process.env.QWEN_FAKE_FAIL) {
  console.log(JSON.stringify({ type: "error", message: "ValueError: broken" }));
  process.exit(1);
}
const total = request.paragraphs.flat().length;
for (let done = 1; done <= total; done++) console.log(JSON.stringify({ type: "progress", done, total }));
fs.writeFileSync(request.output, Buffer.from(process.env.QWEN_FAKE_WAV, "base64"));
console.log(JSON.stringify({ type: "done", samples: 24000, sampleRate: 24000, peak: 0.5 }));
`;
const FAKE_FFMPEG = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.writeFileSync(process.env.QWEN_FAKE_FFMPEG_RECORD, JSON.stringify(args));
fs.writeFileSync(args[args.length - 1], Buffer.from(process.env.QWEN_FAKE_WAV_48K, "base64"));
`;

const NARRATOR = {
  name: "Series narrator",
  version: 1,
  provenance:
    "Original voice designed from a text description with Qwen3-TTS VoiceDesign.",
  reference: {
    file: "reference.wav",
    transcript: "In the summer of fifteen eighteen... something happened.",
  },
  synthesis: {
    language: "english",
    seed: 1,
    sentence_gap_seconds: 0.6,
    paragraph_gap_seconds: 1.2,
    tempo: 0.92,
    loudnorm: "loudnorm=I=-16:TP=-1.5:LRA=11",
    output_sample_rate: 48000,
  },
};

function qwenConfig(kind: string, extra: Record<string, unknown> = {}) {
  return {
    model_type: "qwen3_tts",
    tts_model_type: kind,
    tts_model_size: "1b7",
    talker_config: {
      codec_language_id: { english: 2050, german: 2053, chinese: 2055 },
      spk_id: kind === "custom_voice" ? { ryan: 1, ono_anna: 2 } : {},
    },
    ...extra,
  };
}

let root: string;
let env: Qwen3TtsEnvironment;
let settings: {
  python: string | null;
  voices: string | null;
  ffmpeg: string | null;
};
let processEnv: NodeJS.ProcessEnv;

async function modelFolder(kind: string, extra?: Record<string, unknown>) {
  const folder = join(root, `model-${kind}`);
  await mkdir(folder, { recursive: true });
  await writeFile(
    join(folder, "config.json"),
    JSON.stringify(qwenConfig(kind, extra)),
  );
  return folder;
}

async function profileFolder(
  parent: string,
  id: string,
  voice: Record<string, unknown> = NARRATOR,
) {
  const folder = join(parent, id);
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "voice.json"), JSON.stringify(voice));
  await writeFile(join(folder, "reference.wav"), wav(24000, 2));
  return folder;
}

function context(name: string): ExecutionContext & { messages: string[] } {
  const messages: string[] = [];
  const outputDirectory = join(root, name);
  return {
    signal: new AbortController().signal,
    reportProgress: (event) => messages.push(event.message ?? ""),
    outputDirectory,
    attempt: 1,
    log: () => {},
    messages,
  };
}

async function record<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(join(root, name), "utf8")) as T;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "framebop-qwen-"));
  const python = join(root, "python");
  const ffmpeg = join(root, "ffmpeg");
  await writeFile(python, FAKE_PYTHON);
  await writeFile(ffmpeg, FAKE_FFMPEG);
  await chmod(python, 0o755);
  await chmod(ffmpeg, 0o755);
  settings = { python, voices: join(root, "voices"), ffmpeg };
  await mkdir(join(root, "voices"));
  // FFmpeg runs with the engine's own environment, Python with its own.
  process.env.QWEN_FAKE_FFMPEG_RECORD = join(root, "ffmpeg.json");
  process.env.QWEN_FAKE_WAV_48K = wav(48000, 1.5).toString("base64");
  processEnv = {
    ...process.env,
    QWEN_FAKE_RECORD: join(root, "request.json"),
    QWEN_FAKE_WAV: wav(24000, 1).toString("base64"),
  };
  env = {
    host: { os: "macos", arch: "arm64" },
    get env() {
      return processEnv;
    },
    python: () => settings.python,
    voicesDirectory: () => settings.voices,
    ffmpeg: () => settings.ffmpeg,
  };
});

afterEach(async () => {
  delete process.env.QWEN_FAKE_FFMPEG_RECORD;
  delete process.env.QWEN_FAKE_WAV_48K;
  await rm(root, { recursive: true, force: true });
});

describe("narrationParagraphs", () => {
  it("splits paragraphs at blank lines and sentences before capitals", () => {
    const text =
      "In nineteen oh four, a horse in Berlin became famous. His name was Hans. Ask him to add two and three... and he would tap his hoof five times.\n\nScientists came to watch. Crowds gathered.";
    expect(narrationParagraphs(text)).toEqual([
      [
        "In nineteen oh four, a horse in Berlin became famous.",
        "His name was Hans.",
        "Ask him to add two and three... and he would tap his hoof five times.",
      ],
      ["Scientists came to watch.", "Crowds gathered."],
    ]);
  });

  it("keeps a lone line together and ignores empty text", () => {
    expect(narrationParagraphs("  one\nline  ")).toEqual([["one line"]]);
    expect(narrationParagraphs(" \n\n ")).toEqual([]);
  });
});

describe("atempoFilters", () => {
  it("leaves the natural tempo alone and chains outside 0.5 to 2", () => {
    expect(atempoFilters(1)).toEqual([]);
    expect(atempoFilters(0.92)).toEqual(["atempo=0.92"]);
    expect(atempoFilters(0.3)).toEqual(["atempo=0.5", "atempo=0.6"]);
    expect(atempoFilters(3)).toEqual(["atempo=2", "atempo=1.5"]);
  });
});

describe("readQwen3TtsModel", () => {
  it("reads the variant, size, precision, speakers and languages", async () => {
    const custom = await modelFolder("custom_voice", {
      quantization: { bits: 8, group_size: 64 },
    });
    expect(await readQwen3TtsModel(custom)).toEqual({
      kind: "custom_voice",
      size: "1.7B",
      bits: 8,
      speakers: ["ono_anna", "ryan"],
      languages: ["english", "german", "chinese"],
    });
    const design = await modelFolder("voice_design");
    expect((await readQwen3TtsModel(design))?.kind).toBe("voice_design");
  });

  it("rejects folders that are not Qwen3-TTS", async () => {
    const other = join(root, "other");
    await mkdir(other);
    await writeFile(join(other, "config.json"), '{"model_type":"llama"}');
    expect(await readQwen3TtsModel(other)).toBeNull();
    expect(await readQwen3TtsModel(join(root, "missing"))).toBeNull();
  });
});

describe("voice profiles", () => {
  it("reads a profile's recording, transcript and synthesis settings", async () => {
    const folder = await profileFolder(root, "narrator");
    const profile = await readVoiceProfile(folder);
    expect(profile).toMatchObject({
      id: "narrator",
      name: "Series narrator",
      transcript: NARRATOR.reference.transcript,
      referenceAudio: join(folder, "reference.wav"),
      language: "en",
      settings: {
        seed: 1,
        sentenceGapSeconds: 0.6,
        paragraphGapSeconds: 1.2,
        tempo: 0.92,
        loudnorm: "loudnorm=I=-16:TP=-1.5:LRA=11",
        outputSampleRate: 48000,
      },
    });
  });

  it("fills settings a profile leaves out from the defaults", async () => {
    const { synthesis: _unused, ...minimal } = NARRATOR;
    const profile = await readVoiceProfile(
      await profileFolder(root, "minimal", minimal),
    );
    expect(profile.settings).toEqual(DEFAULT_SYNTHESIS);
  });

  it("refuses profiles without provenance, outside files or other filters", async () => {
    await expect(
      readVoiceProfile(
        await profileFolder(root, "a", { ...NARRATOR, provenance: "" }),
      ),
    ).rejects.toThrow(/provenance/);
    await expect(
      readVoiceProfile(
        await profileFolder(root, "b", {
          ...NARRATOR,
          reference: { ...NARRATOR.reference, file: "../reference.wav" },
        }),
      ),
    ).rejects.toThrow(/reference.file/);
    await expect(
      readVoiceProfile(
        await profileFolder(root, "c", {
          ...NARRATOR,
          synthesis: { loudnorm: "amovie=/etc/passwd" },
        }),
      ),
    ).rejects.toThrow(/loudnorm/);
  });

  it("lists a folder of profiles, or one profile folder itself", async () => {
    const voices = join(root, "voices");
    await profileFolder(voices, "narrator");
    await profileFolder(voices, "broken", { ...NARRATOR, provenance: 3 });
    await mkdir(join(voices, "not-a-profile"));
    const listed = await listVoiceProfiles(voices);
    expect(listed.profiles.map((profile) => profile.id)).toEqual(["narrator"]);
    expect(listed.problems.map((problem) => problem.id)).toEqual(["broken"]);
    const single = await listVoiceProfiles(join(voices, "narrator"));
    expect(single.profiles.map((profile) => profile.id)).toEqual(["narrator"]);
  });
});

describe("Qwen3TtsSpeechAdapter", () => {
  it("is available only on Apple Silicon with Python and FFmpeg", async () => {
    expect((await new Qwen3TtsSpeechAdapter(env).detect()).available).toBe(
      true,
    );
    expect(
      (
        await new Qwen3TtsSpeechAdapter({
          ...env,
          host: { os: "linux", arch: "x64" },
        }).detect()
      ).reason,
    ).toMatch(/Apple Silicon/);
    settings.ffmpeg = null;
    expect((await new Qwen3TtsSpeechAdapter(env).detect()).reason).toMatch(
      /FFmpeg/,
    );
    settings.python = null;
    expect((await new Qwen3TtsSpeechAdapter(env).detect()).reason).toMatch(
      /mlx-audio/,
    );
  });

  it("accepts its runtime, and Qwen3-TTS folders the catalog does not know", async () => {
    const adapter = new Qwen3TtsSpeechAdapter(env);
    const candidate = {
      modelId: null,
      name: "x",
      family: null,
      format: "safetensors",
      verified: false,
      location: { ownership: "external" as const, path: "" },
    };
    const folder = await modelFolder("base");
    expect(
      (
        await adapter.evaluateModel({
          ...candidate,
          runtime: null,
          location: { ownership: "external", path: folder },
        })
      ).usable,
    ).toBe(true);
    expect(
      (
        await adapter.evaluateModel({
          ...candidate,
          runtime: null,
          location: { ownership: "external", path: root },
        })
      ).kind,
    ).toBe("unsupported");
    expect(
      (
        await adapter.evaluateModel({
          ...candidate,
          runtime: "kokoro-pytorch",
          location: { ownership: "external", path: folder },
        })
      ).kind,
    ).toBe("unsupported");
  });

  it("offers profiles, preset speakers or the designed voice by model type", async () => {
    const adapter = new Qwen3TtsSpeechAdapter(env);
    await profileFolder(join(root, "voices"), "narrator");
    expect(
      (await adapter.listVoices(await modelFolder("base"))).map((v) => v.id),
    ).toEqual(["narrator"]);
    const speakers = await adapter.listVoices(
      await modelFolder("custom_voice"),
    );
    expect(speakers.map((voice) => [voice.name, voice.gender])).toEqual([
      ["Ono Anna", "female"],
      ["Ryan", "male"],
    ]);
    expect(
      (await adapter.listVoices(await modelFolder("voice_design"))).map(
        (v) => v.id,
      ),
    ).toEqual(["designed"]);
    settings.voices = null;
    await expect(adapter.listVoices(await modelFolder("base"))).rejects.toThrow(
      /voice profiles/,
    );
  });

  it("speaks with a voice profile and finishes with its tempo, loudness and rate", async () => {
    const adapter = new Qwen3TtsSpeechAdapter(env);
    const profile = await profileFolder(join(root, "voices"), "narrator");
    const model = await modelFolder("base");
    const ctx = context("job");
    await mkdir(ctx.outputDirectory);
    const result = await adapter.generate(
      {
        model,
        text: "His name was Hans. He could count.\n\nOr so they thought.",
        language: "en-US",
        parameters: { voice: "narrator", speed: 1, seed: 0, instruct: "x" },
      },
      ctx,
    );

    const {
      args,
      request,
      env: seen,
    } = await record<{
      args: string[];
      request: Record<string, unknown>;
      env: { offline: string };
    }>("request.json");
    expect(args.slice(0, 2)).toEqual(["-I", "-B"]);
    expect(seen.offline).toBe("1");
    expect(request).toMatchObject({
      model,
      language: "english",
      seed: 1,
      refAudio: join(profile, "reference.wav"),
      refText: NARRATOR.reference.transcript,
      speaker: null,
      instruct: null,
      paragraphs: [
        ["His name was Hans.", "He could count."],
        ["Or so they thought."],
      ],
      sentenceGapSeconds: 0.6,
      paragraphGapSeconds: 1.2,
    });
    const ffmpegArgs = await record<string[]>("ffmpeg.json");
    expect(ffmpegArgs).toContain("atempo=0.92,loudnorm=I=-16:TP=-1.5:LRA=11");
    expect(ffmpegArgs.slice(-7)).toEqual([
      "-ar",
      "48000",
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      join(ctx.outputDirectory, "narration.wav"),
    ]);
    expect(result.artifact.path).toBe(
      join(ctx.outputDirectory, "narration.wav"),
    );
    expect(readWavInfo(await readFile(result.artifact.path)).sampleRate).toBe(
      48000,
    );
    expect(result.model).toBe("Qwen3-TTS 1.7B Base bf16:narrator");
    expect(result.details).toMatchObject({
      voiceProfile: "Series narrator",
      seed: 1,
      tempo: 0.92,
      sentences: 3,
      paragraphs: 2,
      sampleRate: 48000,
    });
    expect(ctx.messages).toContain("Spoke sentence 3 of 3");
  });

  it("passes the description to VoiceDesign and the speaker to CustomVoice", async () => {
    const adapter = new Qwen3TtsSpeechAdapter(env);
    const design = context("design");
    await mkdir(design.outputDirectory);
    await adapter.generate(
      {
        model: await modelFolder("voice_design"),
        text: "Hello there.",
        language: "de",
        parameters: {
          voice: "designed",
          instruct: "A deep voice.",
          speed: 0.5,
          seed: 7,
        },
      },
      design,
    );
    expect(
      (await record<{ request: object }>("request.json")).request,
    ).toMatchObject({
      language: "german",
      seed: 7,
      instruct: "A deep voice.",
      refAudio: null,
      speaker: null,
    });
    expect(await record<string[]>("ffmpeg.json")).toContain(
      "atempo=0.5,loudnorm=I=-16:TP=-1.5:LRA=11",
    );

    const custom = context("custom");
    await mkdir(custom.outputDirectory);
    await adapter.generate(
      {
        model: await modelFolder("custom_voice"),
        text: "Hello there.",
        language: "en",
        parameters: { voice: "Ryan", instruct: "", speed: 1, seed: 0 },
      },
      custom,
    );
    expect(
      (await record<{ request: object }>("request.json")).request,
    ).toMatchObject({
      speaker: "ryan",
      instruct: null,
    });
  });

  it("explains requests it cannot run, before starting Python", async () => {
    const adapter = new Qwen3TtsSpeechAdapter(env);
    const ctx = context("bad");
    const base = await modelFolder("base");
    const ask = (model: string, language: string, parameters: object) =>
      adapter.generate(
        {
          model,
          text: "Hello.",
          language,
          parameters: { speed: 1, seed: 0, ...parameters },
        },
        ctx,
      );
    await expect(ask(base, "en", { voice: "nobody" })).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    await expect(
      ask(await modelFolder("voice_design"), "en", { instruct: " " }),
    ).rejects.toThrow(/Describe the voice/);
    await expect(
      ask(await modelFolder("custom_voice"), "tr", { voice: "ryan" }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED" });
    await expect(ask(root, "en", {})).rejects.toThrow(/not a Qwen3-TTS model/);
  });

  it("reports the engine's own error", async () => {
    processEnv.QWEN_FAKE_FAIL = "1";
    const adapter = new Qwen3TtsSpeechAdapter(env);
    const ctx = context("fail");
    await mkdir(ctx.outputDirectory);
    await expect(
      adapter.generate(
        {
          model: await modelFolder("voice_design"),
          text: "Hello.",
          language: "en",
          parameters: { instruct: "A voice.", speed: 1, seed: 0 },
        },
        ctx,
      ),
    ).rejects.toMatchObject({
      code: "ENGINE_FAILURE",
      message: "Qwen3-TTS failed: ValueError: broken",
    });
  });
});
