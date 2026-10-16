import { open } from "node:fs/promises";
import { runCommand } from "@framebop/ai-adapters";
import { AppError, type AssetKind } from "@framebop/core";

type Container =
  "png" | "jpeg" | "webp" | "wav" | "isobmff" | "matroska" | "mp3" | "flac";

/** Container each accepted extension must actually contain. */
const EXPECTED_CONTAINER: Readonly<Record<string, Container>> = {
  png: "png",
  jpg: "jpeg",
  jpeg: "jpeg",
  webp: "webp",
  mp4: "isobmff",
  m4v: "isobmff",
  mov: "isobmff",
  m4a: "isobmff",
  webm: "matroska",
  wav: "wav",
  mp3: "mp3",
  flac: "flac",
};

// Box types that may legitimately open an MP4 or QuickTime file.
const ISO_LEADING_BOXES = new Set([
  "ftyp",
  "moov",
  "mdat",
  "free",
  "skip",
  "wide",
]);

/** Identifies a media container from the first bytes of a file. */
export function identifyContainer(header: Uint8Array): Container | null {
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...header.subarray(start, end));
  const byte = (index: number) => header[index] ?? 0;

  if (byte(0) === 0x89 && ascii(1, 4) === "PNG") return "png";
  if (byte(0) === 0xff && byte(1) === 0xd8 && byte(2) === 0xff) return "jpeg";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "wav";
  if (ISO_LEADING_BOXES.has(ascii(4, 8))) return "isobmff";
  if (
    byte(0) === 0x1a &&
    byte(1) === 0x45 &&
    byte(2) === 0xdf &&
    byte(3) === 0xa3
  ) {
    return "matroska";
  }
  if (ascii(0, 4) === "fLaC") return "flac";
  if (
    ascii(0, 3) === "ID3" ||
    (byte(0) === 0xff && (byte(1) & 0xe0) === 0xe0)
  ) {
    return "mp3";
  }
  return null;
}

/**
 * Rejects files whose content does not match their extension, for example a
 * text file renamed to `.mp4`. This catches mistakes early with a clear
 * message instead of a broken preview later.
 */
export async function assertContentMatchesExtension(
  filePath: string,
  extension: string,
): Promise<void> {
  const header = new Uint8Array(12);
  const handle = await open(filePath, "r");
  try {
    await handle.read(header, 0, header.length, 0);
  } finally {
    await handle.close();
  }
  if (identifyContainer(header) !== EXPECTED_CONTAINER[extension]) {
    throw new AppError(
      "VALIDATION",
      `This file does not contain valid .${extension} data. It may be corrupt or have the wrong extension.`,
    );
  }
}

export interface MediaMetadata {
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
}

const NO_METADATA: MediaMetadata = {
  width: null,
  height: null,
  durationSeconds: null,
};

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

/**
 * Reads dimensions and duration with ffprobe. Returns nulls when the file
 * cannot be analysed: metadata is helpful but never required for an import.
 */
export async function probeMedia(
  ffprobePath: string,
  filePath: string,
  kind: AssetKind,
): Promise<MediaMetadata> {
  const result = await runCommand(
    ffprobePath,
    [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      filePath,
    ],
    { timeoutMs: 20_000 },
  );
  if (!result.ok) return NO_METADATA;

  let report: { streams?: unknown; format?: unknown };
  try {
    report = JSON.parse(result.stdout) as typeof report;
  } catch {
    return NO_METADATA;
  }

  const streams = Array.isArray(report.streams)
    ? (report.streams as Record<string, unknown>[])
    : [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const format = (report.format ?? {}) as Record<string, unknown>;
  const duration = Number.parseFloat(String(format.duration));

  return {
    width: positiveInteger(video?.width),
    height: positiveInteger(video?.height),
    // ffprobe reports a nominal one-frame duration for stills; ignore it.
    durationSeconds:
      kind !== "image" && Number.isFinite(duration) && duration > 0
        ? duration
        : null,
  };
}

/** Writes a small JPEG preview of an image or of one video frame. */
export async function createThumbnail(
  ffmpegPath: string,
  sourcePath: string,
  destinationPath: string,
  seekSeconds: number,
): Promise<boolean> {
  const seek = seekSeconds > 0 ? ["-ss", seekSeconds.toFixed(2)] : [];
  const result = await runCommand(
    ffmpegPath,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      ...seek,
      "-i",
      sourcePath,
      "-frames:v",
      "1",
      // Downscale to 480px wide at most; never upscale small sources.
      "-vf",
      "scale='min(480,iw)':-2",
      "-q:v",
      "4",
      destinationPath,
    ],
    { timeoutMs: 30_000 },
  );
  return result.ok;
}
