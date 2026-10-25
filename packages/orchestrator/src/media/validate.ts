/**
 * Checks a rendered video before it is reported as finished.
 *
 * ffprobe gives the facts (duration, size, frame rate, codecs). One FFmpeg
 * pass then decodes every frame and every audio sample, which proves the
 * file is readable end to end, and on the way looks for long black stretches
 * where a picture was expected and for narration that cannot be heard above
 * the rest of the mix where it was placed.
 * The last two are reported as warnings: a dark shot or a quiet line can be
 * intended, a corrupt file cannot.
 */
import { runCommand } from "@framebop/ai-adapters";
import type { MediaProbe, OutputCheck, OutputValidation } from "@framebop/core";
import { stat } from "node:fs/promises";

export interface RenderExpectations {
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  /** Where narration was placed, to check that it can be heard. */
  narration: readonly { label: string; from: number; to: number }[];
  /** Where a black picture is intended (scenes with only text). */
  blackAllowed: readonly { from: number; to: number }[];
}

interface Interval {
  from: number;
  to: number;
}

function parseRate(value: unknown): number | null {
  const match = /^(\d+)\/(\d+)$/.exec(String(value ?? ""));
  if (!match) return null;
  const denominator = Number(match[2]);
  return denominator > 0 ? Number(match[1]) / denominator : null;
}

function finite(value: unknown): number | null {
  const number = Number.parseFloat(String(value));
  return Number.isFinite(number) ? number : null;
}

export async function probeOutput(
  ffprobe: string,
  path: string,
): Promise<MediaProbe | null> {
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) return null;
  const result = await runCommand(
    ffprobe,
    [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      path,
    ],
    { timeoutMs: 30_000 },
  );
  if (!result.ok) return null;
  let report: {
    streams?: Record<string, unknown>[];
    format?: Record<string, unknown>;
  };
  try {
    report = JSON.parse(result.stdout) as typeof report;
  } catch {
    return null;
  }
  const streams = report.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  return {
    durationSeconds:
      finite(video?.duration) ?? finite(report.format?.duration) ?? null,
    width: video ? Number(video.width) || null : null,
    height: video ? Number(video.height) || null : null,
    fps: parseRate(video?.avg_frame_rate) ?? parseRate(video?.r_frame_rate),
    videoCodec: typeof video?.codec_name === "string" ? video.codec_name : null,
    audioCodec: typeof audio?.codec_name === "string" ? audio.codec_name : null,
    audioDurationSeconds: finite(audio?.duration),
    sizeBytes: info.size,
  };
}

/** Loudness of consecutive short windows, from `astats` via `ametadata`. */
export function parseLevels(log: string): { at: number; db: number }[] {
  const levels: { at: number; db: number }[] = [];
  let at: number | null = null;
  for (const line of log.split(/\r?\n/)) {
    const time = /pts_time:([\d.]+)/.exec(line);
    if (time) at = Number(time[1]);
    const level = /RMS_level=(-?[\d.]+|-inf|inf)/.exec(line);
    if (level && at !== null) {
      levels.push({
        at,
        db: level[1] === "-inf" || level[1] === "inf" ? -120 : Number(level[1]),
      });
      at = null;
    }
  }
  return levels;
}

/** Window length of the loudness measurement, in seconds. */
const LEVEL_WINDOW = 0.1;

/**
 * Whether each narration segment can be heard above everything else. A
 * segment counts as audible when its loudest window is at least 6 dB above
 * the typical level outside narration (music, room tone), and above -50 dB.
 * Comparing against the rest of the mix is what makes this meaningful when
 * background music would hide a missing or misplaced voice from a plain
 * silence check.
 */
export function inaudibleNarration(
  levels: readonly { at: number; db: number }[],
  narration: RenderExpectations["narration"],
): string[] {
  const middle = (window: { at: number }) => window.at + LEVEL_WINDOW / 2;
  const inNarration = (window: { at: number }) =>
    narration.some(
      (clip) => middle(window) >= clip.from && middle(window) < clip.to,
    );
  const outside = levels
    .filter((window) => !inNarration(window))
    .map((window) => window.db)
    .sort((a, b) => a - b);
  const baseline =
    outside.length > 0 ? outside[Math.floor(outside.length / 2)]! : -120;
  return narration
    .filter((clip) => {
      const inside = levels.filter(
        (window) => middle(window) >= clip.from && middle(window) < clip.to,
      );
      const peak = Math.max(-120, ...inside.map((window) => window.db));
      return peak < Math.max(baseline + 6, -50);
    })
    .map((clip) => clip.label);
}

/** Reads `blackdetect` and `silencedetect` results from FFmpeg's log. */
export function parseDetections(log: string): {
  black: Interval[];
  silence: Interval[];
} {
  const black: Interval[] = [];
  for (const match of log.matchAll(
    /black_start:\s*([\d.]+)\s+black_end:\s*([\d.]+)/g,
  )) {
    black.push({ from: Number(match[1]), to: Number(match[2]) });
  }
  const silence: Interval[] = [];
  let open: number | null = null;
  for (const line of log.split(/\r?\n/)) {
    const start = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (start) open = Math.max(0, Number(start[1]));
    const end = /silence_end:\s*([\d.]+)/.exec(line);
    if (end && open !== null) {
      silence.push({ from: open, to: Number(end[1]) });
      open = null;
    }
  }
  // Silence that lasts until the end has a start but no end.
  if (open !== null) silence.push({ from: open, to: Number.POSITIVE_INFINITY });
  return { black, silence };
}

function overlap(a: Interval, b: Interval): number {
  return Math.max(0, Math.min(a.to, b.to) - Math.max(a.from, b.from));
}

const seconds = (value: number) => `${value.toFixed(2)} s`;

export async function validateRenderOutput(options: {
  ffprobe: string;
  ffmpeg: string;
  path: string;
  expect: RenderExpectations;
  inspector: string;
}): Promise<OutputValidation> {
  const { expect } = options;
  const checks: OutputCheck[] = [];
  const check = (
    label: string,
    result: OutputCheck["result"],
    detail: string,
  ) => checks.push({ label, result, detail });

  const probe = await probeOutput(options.ffprobe, options.path);
  if (!probe) {
    check("File", "fail", "The file is missing or ffprobe cannot read it.");
    return { passed: false, checks, probe: null, inspector: options.inspector };
  }
  check(
    "File",
    probe.sizeBytes > 0 ? "pass" : "fail",
    `${probe.sizeBytes} bytes`,
  );

  const frame = 1 / expect.fps;
  if (probe.durationSeconds === null) {
    check("Duration", "fail", "No duration could be read.");
  } else {
    const off = Math.abs(probe.durationSeconds - expect.durationSeconds);
    check(
      "Duration",
      off <= frame + 0.001 ? "pass" : off <= 0.25 ? "warning" : "fail",
      `${seconds(probe.durationSeconds)}, planned ${seconds(expect.durationSeconds)}`,
    );
  }
  check(
    "Dimensions",
    probe.width === expect.width && probe.height === expect.height
      ? "pass"
      : "fail",
    `${probe.width ?? "?"}×${probe.height ?? "?"}, planned ${expect.width}×${expect.height}`,
  );
  check(
    "Frame rate",
    probe.fps !== null && Math.abs(probe.fps - expect.fps) < 0.01
      ? "pass"
      : "fail",
    `${probe.fps === null ? "unknown" : `${Math.round(probe.fps * 1000) / 1000} fps`}, planned ${expect.fps} fps`,
  );
  check(
    "Video codec",
    probe.videoCodec === "h264" ? "pass" : "fail",
    probe.videoCodec ?? "no video stream",
  );
  check(
    "Audio",
    probe.audioCodec === "aac" ? "pass" : "fail",
    probe.audioCodec ?? "no audio stream",
  );
  if (probe.audioDurationSeconds !== null && probe.durationSeconds !== null) {
    const drift = Math.abs(probe.audioDurationSeconds - probe.durationSeconds);
    check(
      "Audio length matches video",
      drift <= 0.1 ? "pass" : drift <= 0.5 ? "warning" : "fail",
      `audio ${seconds(probe.audioDurationSeconds)}, video ${seconds(probe.durationSeconds)}`,
    );
  }

  // One decoding pass over everything: readability, black and silence.
  const analysis = await runCommand(
    options.ffmpeg,
    [
      "-hide_banner",
      "-nostats",
      "-v",
      "info",
      "-i",
      options.path,
      "-vf",
      "blackdetect=d=1:pix_th=0.06",
      "-af",
      // 0.1 s windows at 48 kHz: the loudness of each, for the narration check.
      // The peak of each window, for the clipping check.
      "aresample=48000,asetnsamples=n=4800:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level,ametadata=print:key=lavfi.astats.Overall.Peak_level",
      "-f",
      "null",
      "-",
    ],
    {
      // Whole milliseconds: a process timeout must be an integer.
      timeoutMs: Math.max(60_000, Math.ceil(expect.durationSeconds * 4000)),
      maxOutputBytes: 16 * 1024 * 1024,
    },
  );
  const decodeErrors = analysis.stderr
    .split(/\r?\n/)
    .filter((line) => /error|invalid|corrupt/i.test(line));
  check(
    "Every frame decodes",
    analysis.ok && decodeErrors.length === 0 ? "pass" : "fail",
    analysis.ok
      ? decodeErrors.length === 0
        ? "Decoded from start to end without errors."
        : decodeErrors.slice(0, 2).join(" | ")
      : "FFmpeg could not decode the file.",
  );

  const { black } = parseDetections(analysis.stderr);
  const unexpectedBlack = black.filter((interval) => {
    const intended = expect.blackAllowed.reduce(
      (sum, allowed) => sum + overlap(interval, allowed),
      0,
    );
    return interval.to - interval.from - intended >= 1;
  });
  check(
    "Picture",
    unexpectedBlack.length === 0 ? "pass" : "warning",
    unexpectedBlack.length === 0
      ? "No unexpected black stretches of a second or more."
      : `Black picture at ${unexpectedBlack.map((i) => `${seconds(i.from)}–${seconds(i.to)}`).join(", ")}.`,
  );

  if (expect.narration.length > 0) {
    const quiet = inaudibleNarration(
      parseLevels(analysis.stderr),
      expect.narration,
    );
    check(
      "Narration audible where placed",
      quiet.length === 0 ? "pass" : "warning",
      quiet.length === 0
        ? `All ${expect.narration.length} narration segments stand out from the rest of the mix where they were placed.`
        : `No narration could be heard above the rest of the mix where it was placed: ${quiet.join(", ")}.`,
    );
  }

  const peak = parsePeak(analysis.stderr);
  if (peak !== null) {
    check(
      "Audio peaks",
      peak < -0.1 ? "pass" : "warning",
      peak < -0.1
        ? `Highest peak ${peak.toFixed(1)} dBFS, below clipping.`
        : `Peaks reach ${peak.toFixed(1)} dBFS, so the sound may clip. Lower the music or narration volume.`,
    );
  }

  return {
    passed: checks.every((entry) => entry.result !== "fail"),
    checks,
    probe,
    inspector: options.inspector,
  };
}

/** The loudest sample peak in dBFS, from `astats`, or null without audio. */
export function parsePeak(log: string): number | null {
  let highest: number | null = null;
  for (const match of log.matchAll(
    /lavfi\.astats\.Overall\.Peak_level=(-?[\d.]+)/g,
  )) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && (highest === null || value > highest)) {
      highest = value;
    }
  }
  return highest;
}
