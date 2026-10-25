import type {
  EngineCapability,
  EngineStatus,
  ToolStatus,
} from "@framebop/core";
import type { AnyAdapter } from "./contracts";
import type { AdapterRegistry } from "./registry";

/** Text shown for a backend, keyed by adapter id. */
const DESCRIPTIONS: Readonly<Record<string, string>> = {
  "test-pattern":
    "A built-in adapter that draws a test pattern. It loads no AI model and exists to try queueing, progress, cancelling, failure and retry.",
  "draw-things":
    "The Draw Things app, driven through its HTTP API server. That API returns still images only, so video is not available this way: use the Draw Things CLI, or generate clips in the app and import them.",
  "draw-things-cli":
    "The official Draw Things command-line tool, a separate download from the app. It can write video files and can be stopped mid-run.",
  kokoro:
    "Kokoro-82M text-to-speech through the kokoro Python package, in an interpreter you choose. Loads the model from files on this computer and never downloads anything.",
  "qwen3-tts":
    "Qwen3-TTS through the mlx-audio Python package, in an interpreter you choose, on Apple Silicon. Base models clone a voice profile, VoiceDesign models make a voice from a description, CustomVoice models use preset speakers. Loads models from files on this computer and never downloads anything.",
  remotion:
    "Composes the episode from its scenes, narration, music and captions, and writes an H.264 MP4. Runs in a separate process with a headless Chrome build you choose.",
};

const TASK_WORDS: Record<string, string> = {
  image_generation: "images",
  video_generation: "video",
  audio_generation: "narration",
  video_render: "rendering",
};

async function describeAdapter(adapter: AnyAdapter): Promise<{
  capability: EngineCapability;
  version: string | null;
  location: string | null;
  installed: boolean;
}> {
  const [availability, capabilities] = await Promise.all([
    adapter.detect(),
    adapter.getCapabilities(),
  ]);
  return {
    capability: {
      task: adapter.task,
      available: availability.available,
      reason: availability.reason,
      maturity: capabilities.maturity,
      models: [...capabilities.models],
      requiresModel: capabilities.requiresModel,
      parameters: [...capabilities.parameters],
      resolutions: [...capabilities.resolutions],
      requiresPrompt: capabilities.requiresPrompt,
      requiresInputImage: capabilities.requiresInputImage,
      acceptsInputImage:
        capabilities.requiresInputImage ||
        (capabilities.acceptsInputImage ?? false),
      supportsNegativePrompt: capabilities.supportsNegativePrompt ?? false,
      supportsSeed: capabilities.supportsSeed ?? false,
      maxClipSeconds: capabilities.maxClipSeconds ?? null,
      outputFormats: [...(capabilities.outputFormats ?? [])],
      supportsCancellation: capabilities.supportsCancellation,
      reportsProgress: capabilities.reportsProgress,
      expensive: capabilities.expensive,
      notes: [...capabilities.notes],
    },
    version: availability.version,
    location: availability.location,
    installed: availability.installed,
  };
}

/** One status per backend, combining its adapters for different tasks. */
async function describeBackends(
  registry: AdapterRegistry,
): Promise<EngineStatus[]> {
  const byBackend = new Map<string, AnyAdapter[]>();
  for (const adapter of registry.list()) {
    byBackend.set(adapter.id, [...(byBackend.get(adapter.id) ?? []), adapter]);
  }

  return Promise.all(
    [...byBackend.values()].map(async (adapters): Promise<EngineStatus> => {
      const [first] = adapters;
      if (!first) throw new Error("A backend has no adapters.");
      const described = await Promise.all(adapters.map(describeAdapter));
      const capabilities = described.map((entry) => entry.capability);
      const usable = capabilities.filter((capability) => capability.available);
      const installed = described.some((entry) => entry.installed);
      const tasks = capabilities.map((c) => TASK_WORDS[c.task] ?? c.task);

      return {
        id: first.id,
        name: first.name,
        kind: capabilities.some((c) => c.task === "video_render")
          ? "render"
          : capabilities.some((c) => c.task === "audio_generation")
            ? "speech"
            : capabilities.some((c) => c.task === "video_generation")
              ? "video"
              : "image",
        state:
          usable.length > 0
            ? "available"
            : installed
              ? "detected"
              : "not_found",
        summary:
          usable.length > 0
            ? `Ready for ${tasks.filter((_, i) => capabilities[i]?.available).join(" and ")}`
            : (capabilities[0]?.reason ?? "Not available"),
        detail: DESCRIPTIONS[first.id] ?? "",
        version: described.find((entry) => entry.version)?.version ?? null,
        location: described.find((entry) => entry.location)?.location ?? null,
        plannedPhase: null,
        isTest: first.isTest,
        capabilities,
      };
    }),
  );
}

function describeFfmpeg(ffmpeg: ToolStatus, ffprobe: ToolStatus): EngineStatus {
  const base: Pick<
    EngineStatus,
    "id" | "name" | "kind" | "plannedPhase" | "isTest" | "capabilities"
  > = {
    id: "ffmpeg",
    name: "FFmpeg",
    kind: "tool",
    plannedPhase: null,
    isTest: false,
    capabilities: [],
  };
  if (ffmpeg.available && ffprobe.available) {
    return {
      ...base,
      state: "available",
      summary: "Media analysis and thumbnails",
      detail:
        "Used to read dimensions and duration of imported media and to create thumbnails.",
      version: ffmpeg.version,
      location: ffmpeg.path,
    };
  }
  return {
    ...base,
    state: "not_found",
    summary: "Not found",
    detail:
      "Without it, thumbnails are rendered live, a file's dimensions and duration are filled in the first time you preview it, and exported videos cannot be checked after rendering.",
    version: null,
    location: null,
  };
}

function planned(
  entry: Pick<EngineStatus, "id" | "name" | "kind" | "detail"> & {
    plannedPhase: number;
  },
): EngineStatus {
  return {
    ...entry,
    state: "planned",
    summary: "Planned",
    version: null,
    location: null,
    isTest: false,
    capabilities: [],
  };
}

/**
 * Reports every engine Framebop Studio knows about and its true state on this
 * machine: the adapters compiled into this build, the tools it uses, and the
 * integrations that are planned but do not exist, each labelled as such.
 */
export async function describeEngines(
  registry: AdapterRegistry,
  tools: { ffmpeg: ToolStatus; ffprobe: ToolStatus },
): Promise<EngineStatus[]> {
  return [
    {
      id: "manual-import",
      name: "Manual import",
      kind: "import",
      state: "available",
      summary: "Bring your own images, clips and audio",
      detail:
        "Always available. Create media in any tool and import the files. They are copied into the library, so originals can be moved or deleted afterwards.",
      version: null,
      location: null,
      plannedPhase: null,
      isTest: false,
      capabilities: [],
    },
    describeFfmpeg(tools.ffmpeg, tools.ffprobe),
    ...(await describeBackends(registry)),
    planned({
      id: "comfyui",
      name: "ComfyUI",
      kind: "video",
      detail:
        "Intended as the main image and video backend on Windows and Linux with CUDA GPUs. No detection or integration exists yet.",
      plannedPhase: 3,
    }),
    planned({
      id: "native-runtime",
      name: "Built-in model runtime",
      kind: "video",
      detail:
        "A managed runtime (MLX on Apple Silicon) so models can be installed from the app without configuring Python. Not started.",
      plannedPhase: 3,
    }),
  ];
}
