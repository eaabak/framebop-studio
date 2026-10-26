import {
  LtxVideoAdapter,
  type LtxVideoEnvironment,
} from "./adapters/ltx-video";
import type { ToolStatus } from "@framebop/core";
import {
  DrawThingsCliImageAdapter,
  DrawThingsCliVideoAdapter,
} from "./adapters/draw-things-cli";
import { DrawThingsHttpImageAdapter } from "./adapters/draw-things-http";
import { KokoroSpeechAdapter } from "./adapters/kokoro";
import { Qwen3TtsSpeechAdapter } from "./adapters/qwen3-tts";
import {
  type StableDiffusionCppEnvironment,
  StableDiffusionCppImageAdapter,
  StableDiffusionCppVideoAdapter,
} from "./adapters/stable-diffusion-cpp";
import {
  type SherpaOnnxEnvironment,
  SherpaOnnxSpeechAdapter,
} from "./adapters/sherpa-onnx";
import {
  type RemotionEnvironment,
  RemotionRenderAdapter,
} from "./adapters/remotion";
import {
  TestPatternImageAdapter,
  TestPatternVideoAdapter,
} from "./adapters/test-pattern";
import type { HostPlatform } from "./host/platform";
import { AdapterRegistry } from "./registry";

export interface RegistryEnvironment {
  host: HostPlatform;
  env: NodeJS.ProcessEnv;
  /** Current state of FFmpeg, read whenever an adapter needs it. */
  ffmpeg: () => ToolStatus;
  /** Configured port of the Draw Things HTTP API server. */
  drawThingsHttpPort: () => number;
  /** The Python interpreter chosen for Kokoro, if any. */
  kokoroPython: () => string | null;
  /** The Python interpreter chosen for Qwen3-TTS (with mlx-audio), if any. */
  qwenTtsPython: () => string | null;
  /** The folder of Qwen3-TTS voice profiles chosen in settings, if any. */
  qwenVoicesDirectory: () => string | null;
  ltxVideo: Omit<LtxVideoEnvironment, "host" | "env" | "ffmpeg">;
  /** Where the render worker and its composition are. */
  remotion: RemotionEnvironment;
  /** Framebop's own image runtime, installed and pinned by the engine. */
  stableDiffusionCpp: StableDiffusionCppEnvironment["runtime"];
  /** Which file does what in an installed model, from the catalog. */
  modelParts: NonNullable<StableDiffusionCppEnvironment["parts"]>;
  /** Framebop's own voice runtime and the voice packs installed for it. */
  sherpaOnnx: SherpaOnnxEnvironment;
}

/**
 * The adapters that ship with Framebop Studio.
 *
 * This is the one place that names concrete backends. The production engine
 * receives the registry and works only with the adapter interfaces, so adding
 * a backend means adding an adapter here and nothing else.
 */
export function createDefaultRegistry(
  environment: RegistryEnvironment,
): AdapterRegistry {
  const { host, env } = environment;
  const ffmpegPath = () => {
    const tool = environment.ffmpeg();
    return tool.available ? tool.path : null;
  };
  return new AdapterRegistry()
    .register(new TestPatternImageAdapter())
    .register(
      new StableDiffusionCppImageAdapter({
        runtime: environment.stableDiffusionCpp,
        parts: environment.modelParts,
      }),
    )
    .register(new TestPatternVideoAdapter(ffmpegPath))
    .register(
      new LtxVideoAdapter({
        ...environment.ltxVideo,
        host,
        env,
        ffmpeg: ffmpegPath,
      }),
    )
    .register(
      new StableDiffusionCppVideoAdapter({
        runtime: environment.stableDiffusionCpp,
        ffmpeg: ffmpegPath,
        parts: environment.modelParts,
      }),
    )
    .register(
      new DrawThingsHttpImageAdapter(host, environment.drawThingsHttpPort),
    )
    .register(new DrawThingsCliImageAdapter({ host, env }))
    .register(new DrawThingsCliVideoAdapter({ host, env }))
    .register(new SherpaOnnxSpeechAdapter(environment.sherpaOnnx))
    .register(
      new KokoroSpeechAdapter({ env, python: environment.kokoroPython }),
    )
    .register(
      new Qwen3TtsSpeechAdapter({
        host,
        env,
        python: environment.qwenTtsPython,
        voicesDirectory: environment.qwenVoicesDirectory,
        ffmpeg: ffmpegPath,
      }),
    )
    .register(new RemotionRenderAdapter(environment.remotion));
}
