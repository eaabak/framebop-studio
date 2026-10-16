/**
 * Checks a generated file before it enters the library: that it decodes from
 * start to end, and what it really is (size, length, frame rate, codec), as
 * measured rather than as the engine said. For a clip made from a still, it
 * also measures how close the clip's first and last frames are to that still.
 */
import { stat } from "node:fs/promises";
import { runCommand } from "@framebop/ai-adapters";
import type { MediaVerification } from "@framebop/core";
import { probeOutput } from "./validate";

/** Codecs the editor's preview and the renderer can both play. */
const PLAYABLE_CODECS = new Set([
  "h264",
  "hevc",
  "prores",
  "vp8",
  "vp9",
  "av1",
  "mpeg4",
]);

export interface VerifyOptions {
  ffmpeg: string | null;
  ffprobe: string | null;
  path: string;
  kind: "image" | "video";
  /** The still a clip was made from, to compare its frames with. */
  inputImagePath?: string | null;
  signal?: AbortSignal;
}

const UNMEASURED = {
  width: null,
  height: null,
  durationSeconds: null,
  fps: null,
  codec: null,
  frames: null,
  similarity: null,
} as const;

/** Structural similarity reported by FFmpeg's `ssim` filter, or null. */
function parseSsim(log: string): number | null {
  const match = /All:\s*([\d.]+)/.exec(log);
  const value = match ? Number(match[1]) : Number.NaN;
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
}

/**
 * Compares a clip with the still it started from: its first frame, and the
 * average of its last quarter second. The still is fitted to the clip the way
 * engines fit a starting image, by filling the frame and cropping the rest.
 */
async function similarity(
  ffmpeg: string,
  clip: string,
  still: string,
  width: number,
  height: number,
  signal?: AbortSignal,
): Promise<{ first: number | null; last: number | null }> {
  const fit = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},format=yuv420p`;
  const compare = (seek: string[], trim: string) =>
    runCommand(
      ffmpeg,
      [
        "-hide_banner",
        "-nostats",
        ...seek,
        "-i",
        clip,
        "-loop",
        "1",
        "-i",
        still,
        "-filter_complex",
        `[0:v]${trim}format=yuv420p[a];[1:v]${fit}[b];[a][b]ssim=shortest=1`,
        "-f",
        "null",
        "-",
      ],
      { timeoutMs: 60_000, signal },
    );
  const [first, last] = await Promise.all([
    compare([], "trim=end_frame=1,"),
    compare(["-sseof", "-0.25"], ""),
  ]);
  return {
    first: first.ok ? parseSsim(first.stderr) : null,
    last: last.ok ? parseSsim(last.stderr) : null,
  };
}

/** Lowest and highest brightness in a picture, from `signalstats`. */
async function brightnessRange(
  ffmpeg: string,
  path: string,
  signal?: AbortSignal,
): Promise<{ min: number; max: number } | null> {
  const result = await runCommand(
    ffmpeg,
    [
      "-hide_banner",
      "-v",
      "error",
      "-i",
      path,
      "-frames:v",
      "1",
      "-vf",
      "signalstats,metadata=print:file=-",
      "-f",
      "null",
      "-",
    ],
    { timeoutMs: 30_000, signal },
  );
  if (!result.ok) return null;
  const min = /lavfi\.signalstats\.YMIN=(\d+)/.exec(result.stdout);
  const max = /lavfi\.signalstats\.YMAX=(\d+)/.exec(result.stdout);
  return min && max ? { min: Number(min[1]), max: Number(max[1]) } : null;
}

export async function verifyGeneratedMedia(
  options: VerifyOptions,
): Promise<MediaVerification> {
  const { ffmpeg, ffprobe, path, kind, signal } = options;
  const info = await stat(path).catch(() => null);
  if (!info?.isFile() || info.size === 0) {
    return {
      status: "failed",
      problems: ["The file is missing or empty."],
      ...UNMEASURED,
    };
  }
  if (ffmpeg === null || ffprobe === null) {
    // Only the file's signature could be checked, by the caller.
    return {
      status: "partial",
      problems: ["FFmpeg is not available, so the file could not be decoded."],
      ...UNMEASURED,
    };
  }

  const probe = await probeOutput(ffprobe, path);
  if (probe === null) {
    return {
      status: "failed",
      problems: ["The file could not be read as media."],
      ...UNMEASURED,
    };
  }
  const problems: string[] = [];
  if (!probe.width || !probe.height) {
    problems.push("No picture size could be read.");
  }

  let frames: number | null = null;
  let similarityResult: MediaVerification["similarity"] = null;
  if (kind === "image") {
    const range = await brightnessRange(ffmpeg, path, signal);
    if (range === null) {
      problems.push("The picture could not be decoded.");
    } else if (range.max - range.min < 2) {
      problems.push(
        "The picture is one flat colour, which usually means the engine failed.",
      );
    }
  } else {
    if (!probe.videoCodec) problems.push("The file has no video stream.");
    else if (!PLAYABLE_CODECS.has(probe.videoCodec)) {
      problems.push(
        `Its ${probe.videoCodec} video cannot be played by the editor and renderer.`,
      );
    }
    if (!probe.fps || probe.fps <= 0) {
      problems.push("No frame rate could be read.");
    }
    if (!probe.durationSeconds || probe.durationSeconds <= 0) {
      problems.push("No duration could be measured.");
    }
    // Counting frames decodes every one of them.
    const counted = await runCommand(
      ffprobe,
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-count_frames",
        "-show_entries",
        "stream=nb_read_frames",
        "-of",
        "csv=p=0",
        path,
      ],
      { timeoutMs: 120_000, signal },
    );
    frames = counted.ok ? Number.parseInt(counted.stdout.trim(), 10) : null;
    if (frames === null || !Number.isFinite(frames) || frames < 1) {
      frames = null;
      problems.push("Its frames could not be decoded.");
    }
    if (
      options.inputImagePath &&
      problems.length === 0 &&
      probe.width &&
      probe.height
    ) {
      similarityResult = await similarity(
        ffmpeg,
        path,
        options.inputImagePath,
        probe.width,
        probe.height,
        signal,
      );
    }
  }

  return {
    status: problems.length > 0 ? "failed" : "passed",
    problems,
    width: probe.width,
    height: probe.height,
    durationSeconds: kind === "video" ? probe.durationSeconds : null,
    fps: kind === "video" ? probe.fps : null,
    codec: probe.videoCodec,
    frames,
    similarity: similarityResult,
  };
}
