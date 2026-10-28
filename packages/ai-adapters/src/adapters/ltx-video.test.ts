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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ltxFrameCounts } from "@framebop/core";
import type { ExecutionContext, VideoGenerationRequest } from "../contracts";
import {
  LtxVideoAdapter,
  ltxEncoderReady,
  ltxPackDirectory,
} from "./ltx-video";

const PYTHON = `#!/usr/bin/env node
const fs = require('node:fs');
if(process.argv.includes('-c')) { console.log(JSON.stringify({'ltx-core-mlx':'0.18.0','ltx-pipelines-mlx':'0.18.0',mlx:'0.32.2','mlx-lm':'0.31.1'})); process.exit(0); }
const request=JSON.parse(fs.readFileSync(0,'utf8'));
fs.writeFileSync(process.env.LTX_RECORD,JSON.stringify({request,offline:process.env.HF_HUB_OFFLINE,token:process.env.HF_TOKEN??null,pid:process.pid}));
if(process.env.LTX_WAIT) { setInterval(()=>{},1000); }
else if(process.env.LTX_FAIL) { console.log(JSON.stringify({type:'error',message:'Model failed deliberately'})); process.exit(1); }
else {
 console.log(JSON.stringify({type:'phase',stage:'loading_model',message:'Loading'}));
 console.log(JSON.stringify({type:'progress',done:8,total:11,message:'Stage 1 complete'}));
 if (!process.env.LTX_NO_OUTPUT) fs.writeFileSync(request.output,Buffer.from('test video'));
 console.log(JSON.stringify({type:'done',seconds:1,peakMetalBytes:1024,peakRssBytes:2048}));
}
`;
const FFMPEG = `#!/usr/bin/env node
const fs=require('node:fs');if(process.argv.includes('-h')){console.log('Filter minterpolate');process.exit(0);} if(process.env.LTX_FFMPEG_FAIL)process.exit(1);fs.writeFileSync(process.env.LTX_ENCODING,JSON.stringify(process.argv.slice(2)));fs.writeFileSync(process.argv.at(-1),Buffer.from('encoded video'));
`;
let root: string,
  model: string,
  encoder: string,
  python: string,
  ffmpeg: string;
let env: NodeJS.ProcessEnv;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "ltx-adapter-"));
  model = join(root, "model");
  encoder = model;
  await mkdir(model);
  await writeFile(
    join(model, "embedded_config.json"),
    JSON.stringify({ model_version: "2.5.0" }),
  );
  await writeFile(
    join(model, "quantize_config.json"),
    JSON.stringify({ quantization: { bits: 4 } }),
  );
  await writeFile(
    join(model, "text_encoder_config.json"),
    JSON.stringify({
      model_type: "gemma4_unified",
      gemma_version: "gemma4-12b-ltx-v1",
    }),
  );
  for (const file of [
    "transformer-distilled.safetensors",
    "connector.safetensors",
    "vae_encoder_conv.safetensors",
    "vae_decoder_conv.safetensors",
    "spatial_upscaler_x2_v1_0.safetensors",
    "spatial_upscaler_x2_v1_0_config.json",
    "split_model.json",
    "text_encoder.safetensors",
    "tokenizer.json",
    "tokenizer_config.json",
  ])
    await writeFile(join(model, file), "fixture");
  python = join(root, "python");
  ffmpeg = join(root, "ffmpeg");
  await writeFile(python, PYTHON);
  await writeFile(ffmpeg, FFMPEG);
  await chmod(python, 0o755);
  await chmod(ffmpeg, 0o755);
  env = {
    ...process.env,
    HF_TOKEN: "must-not-reach-the-model",
    LTX_RECORD: join(root, "request.json"),
    LTX_ENCODING: join(root, "encoding.json"),
  };
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
function adapter(os = "macos", arch = "arm64") {
  return new LtxVideoAdapter({
    host: { os, arch } as never,
    env,
    python: () => python,
    modelDirectory: () => model,
    ffmpeg: () => ffmpeg,
  });
}
const request = (): VideoGenerationRequest => ({
  model,
  prompt: "A fox watches a butterfly",
  negativePrompt: "",
  width: 640,
  height: 384,
  seed: 43,
  parameters: {},
  durationSeconds: 5,
  inputImage: null,
});
const context = (signal = new AbortController().signal): ExecutionContext => ({
  signal,
  outputDirectory: root,
  attempt: 1,
  log: () => {},
  reportProgress: () => {},
});

describe("LTX video boundary", () => {
  it("generates on the temporal grid while delivering exactly the requested duration", () => {
    expect(ltxFrameCounts(5)).toEqual({
      outputFrames: 120,
      generatedFrames: 121,
      actualSeconds: 5,
    });
    expect(ltxFrameCounts(10)).toEqual({
      outputFrames: 240,
      generatedFrames: 241,
      actualSeconds: 10,
    });
    expect(ltxFrameCounts(1.5).generatedFrames).toBe(41);
    for (const value of [0, 0.5, 10.5, NaN, Infinity])
      expect(() => ltxFrameCounts(value)).toThrow();
  });
  it("requires a complete 2.5 pack with the bundled compatible Gemma 4 tower", async () => {
    expect(await ltxPackDirectory(model)).toBe(model);
    expect(await ltxPackDirectory(join(model, "not-a-real-file"))).toBeNull();
    expect(await ltxEncoderReady(encoder)).toBe(true);
    await rm(join(model, "text_encoder.safetensors"));
    expect(await ltxEncoderReady(encoder)).toBe(false);
    expect(await ltxPackDirectory(model)).toBeNull();
  });
  it("detects the pinned runtime on Apple Silicon only", async () => {
    expect((await adapter().detect()).available).toBe(true);
    expect((await adapter("linux", "arm64").detect()).available).toBe(false);
    expect((await adapter("macos", "x64").detect()).available).toBe(false);
  });
  it("refuses legacy packs, unsupported Gemma versions and non-Q4 weights", async () => {
    await writeFile(
      join(model, "embedded_config.json"),
      JSON.stringify({ model_version: "2.3.0" }),
    );
    expect(await ltxPackDirectory(model)).toBeNull();
    await writeFile(
      join(model, "embedded_config.json"),
      JSON.stringify({ model_version: "2.5.0" }),
    );
    await writeFile(
      join(model, "text_encoder_config.json"),
      JSON.stringify({
        model_type: "gemma4_unified",
        gemma_version: "unsupported",
      }),
    );
    expect(await ltxPackDirectory(model)).toBeNull();
    await writeFile(
      join(model, "text_encoder_config.json"),
      JSON.stringify({
        model_type: "gemma4_unified",
        gemma_version: "gemma4-12b-ltx-v1",
      }),
    );
    await writeFile(
      join(model, "quantize_config.json"),
      JSON.stringify({ quantization: { bits: 8 } }),
    );
    expect(await ltxPackDirectory(model)).toBeNull();
  });
  it("passes the reference image, strips hub tokens and trims the sampler's extra frame", async () => {
    const events: unknown[] = [];
    const result = await adapter().generate(
      {
        ...request(),
        inputImage: {
          path: join(root, "fox.png"),
          mimeType: "image/png",
          width: 640,
          height: 384,
        },
        parameters: { referenceStrength: 0.8 },
      },
      { ...context(), reportProgress: (event) => events.push(event) },
    );
    const recorded = JSON.parse(await readFile(env.LTX_RECORD!, "utf8"));
    expect(recorded.request).toMatchObject({
      frames: 121,
      outputFrames: 120,
      seed: 43,
      inputImage: join(root, "fox.png"),
      referenceStrength: 0.8,
      model,
    });
    expect(recorded.request).not.toHaveProperty("textEncoder");
    expect(recorded.offline).toBe("1");
    expect(recorded.token).toBeNull();
    // The Python sink trims before the only encoding pass; no second FFmpeg.
    await expect(readFile(env.LTX_ENCODING!)).rejects.toBeDefined();
    expect(result.details).toMatchObject({
      outputFrames: 120,
      peakMetalBytes: 1024,
      encodingPasses: 1,
    });
    expect(events).toContainEqual({
      fraction: 8 / 11,
      stage: "generating",
      message: "Stage 1 complete",
    });
  });
  it("passes an experimental 1408×768 ten-second request and trims it to 240 frames", async () => {
    expect((await adapter().getCapabilities()).maxClipSeconds).toBe(10);
    const result = await adapter().generate(
      { ...request(), durationSeconds: 10, width: 1408, height: 768 },
      context(),
    );
    const recorded = JSON.parse(await readFile(env.LTX_RECORD!, "utf8"));
    expect(recorded.request).toMatchObject({
      frames: 241,
      outputFrames: 240,
      width: 1408,
      height: 768,
    });
    await expect(readFile(env.LTX_ENCODING!)).rejects.toBeDefined();
    expect(result.details).toMatchObject({
      outputFrames: 240,
      durationSeconds: 10,
    });
  });
  it("generates portrait frames natively rather than rotating a landscape result", async () => {
    expect((await adapter().getCapabilities()).resolutions).toContainEqual({
      width: 576,
      height: 1024,
    });
    const result = await adapter().generate(
      { ...request(), width: 576, height: 1024 },
      context(),
    );
    const recorded = JSON.parse(await readFile(env.LTX_RECORD!, "utf8"));
    expect(recorded.request).toMatchObject({
      width: 576,
      height: 1024,
      frames: 121,
    });
    expect(result).toBeDefined();
  });
  it("rejects unsupported size, duration and negative prompts before inference", async () => {
    for (const change of [
      { width: 1920 },
      { durationSeconds: 11 },
      { negativePrompt: "bad" },
    ])
      await expect(
        adapter().generate({ ...request(), ...change }, context()),
      ).rejects.toBeDefined();
    await expect(readFile(env.LTX_RECORD!)).rejects.toBeDefined();
  });
  it("preserves the runtime's failure instead of accepting an unfinished file", async () => {
    env.LTX_FAIL = "1";
    await expect(adapter().generate(request(), context())).rejects.toThrow(
      "Model failed deliberately",
    );
    await expect(readFile(env.LTX_ENCODING!)).rejects.toBeDefined();
  });
  it("interpolates only after generation and reports the delivered frame contract", async () => {
    const result = await adapter().generate(
      { ...request(), parameters: { interpolate60fps: true } },
      context(),
    );
    const args = JSON.parse(await readFile(env.LTX_ENCODING!, "utf8"));
    expect(args).toContain("-vf");
    expect(args.find((a: string) => a.includes("minterpolate="))).toContain(
      "trim=duration=5",
    );
    expect(result.artifact.path).toBe(join(root, "clip-60fps.mp4"));
    expect(result.expectedVideo).toEqual({
      width: 640,
      height: 384,
      fps: 60,
      frames: 300,
    });
    expect(result.details).toMatchObject({
      sourceFps: 24,
      fps: 60,
      encodingPasses: 2,
      interpolated60fps: true,
    });
  });
  it("rejects missing enhancement weights and invalid flags before generation", async () => {
    const cases: VideoGenerationRequest["parameters"][] = [
      { enhance1080p: true },
      { interpolate60fps: "yes" },
    ];
    for (const parameters of cases) {
      await expect(
        adapter().generate({ ...request(), parameters }, context()),
      ).rejects.toBeDefined();
    }
    await expect(readFile(env.LTX_RECORD!)).rejects.toBeDefined();
  });
  it("fails interpolation without returning the unprocessed clip as success", async () => {
    env.LTX_FFMPEG_FAIL = "1";
    await expect(
      adapter().generate(
        { ...request(), parameters: { interpolate60fps: true } },
        context(),
      ),
    ).rejects.toBeDefined();
  });
  it("rejects a completed protocol message without an output artifact", async () => {
    env.LTX_NO_OUTPUT = "1";
    await expect(adapter().generate(request(), context())).rejects.toThrow(
      "did not produce a video",
    );
  });
  it("cancels the process and never starts final encoding", async () => {
    env.LTX_WAIT = "1";
    const abort = new AbortController();
    const running = adapter().generate(request(), context(abort.signal));
    for (let i = 0; i < 100; i++) {
      if (
        await readFile(env.LTX_RECORD!).then(
          () => true,
          () => false,
        )
      )
        break;
      await new Promise((r) => setTimeout(r, 10));
    }
    abort.abort();
    await expect(running).rejects.toMatchObject({ code: "CANCELLED" });
    await expect(readFile(env.LTX_ENCODING!)).rejects.toBeDefined();
    const { pid } = JSON.parse(await readFile(env.LTX_RECORD!, "utf8"));
    expect(() => process.kill(pid, 0)).toThrow();
  });
  it("does not schedule a generation deadline by default or for an explicit zero", async () => {
    const timers = vi.spyOn(globalThis, "setTimeout");
    try {
      const cases: Record<string, number>[] = [{}, { timeoutSeconds: 0 }];
      for (const parameters of cases) {
        await adapter().generate({ ...request(), parameters }, context());
      }
      const delays = timers.mock.calls.map((call) => call[1]);
      expect(delays).not.toContain(0);
      expect(delays).not.toContain(1_200_000);
    } finally {
      timers.mockRestore();
    }
  });
  it("enforces the model deadline without accepting or encoding a partial result", async () => {
    env.LTX_WAIT = "1";
    const realTimeout = globalThis.setTimeout;
    const spy = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation(((
        callback: (...args: unknown[]) => void,
        delay?: number,
        ...args: unknown[]
      ) =>
        realTimeout(
          callback,
          delay === 60_000 ? 50 : delay,
          ...args,
        )) as typeof setTimeout);
    try {
      await expect(
        adapter().generate(
          { ...request(), parameters: { timeoutSeconds: 60 } },
          context(),
        ),
      ).rejects.toThrow("deadline");
      await expect(readFile(env.LTX_ENCODING!)).rejects.toBeDefined();
    } finally {
      spy.mockRestore();
    }
  });
});
