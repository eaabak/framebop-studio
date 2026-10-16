import { z } from "zod";

/**
 * What was checked about a generated file before it entered the library.
 * "partial" means the file passed the checks that could be made, but a tool
 * needed for the rest (FFmpeg) was missing.
 */
export const MediaVerificationSchema = z.object({
  status: z.enum(["passed", "failed", "partial"]),
  problems: z.array(z.string()),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  durationSeconds: z.number().nullable(),
  fps: z.number().nullable(),
  codec: z.string().nullable(),
  /** Frames decoded from start to end, for clips. */
  frames: z.number().int().nullable(),
  /**
   * For a clip made from a still: structural similarity (SSIM, 0..1) of its
   * first and last frame to that still. A measurement, not a verdict on how
   * well the picture was kept.
   */
  similarity: z
    .object({ first: z.number().nullable(), last: z.number().nullable() })
    .nullable(),
});
export type MediaVerification = z.infer<typeof MediaVerificationSchema>;

export const ASSET_KINDS = ["image", "video", "audio"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

interface MediaFormat {
  kind: AssetKind;
  mimeType: string;
}

/**
 * The only file types the engine will import. Keyed by lowercase extension
 * without the dot. Kept deliberately small: every entry must be previewable
 * by the system webview.
 */
export const MEDIA_FORMATS: Readonly<Record<string, MediaFormat>> = {
  png: { kind: "image", mimeType: "image/png" },
  jpg: { kind: "image", mimeType: "image/jpeg" },
  jpeg: { kind: "image", mimeType: "image/jpeg" },
  webp: { kind: "image", mimeType: "image/webp" },
  mp4: { kind: "video", mimeType: "video/mp4" },
  m4v: { kind: "video", mimeType: "video/mp4" },
  mov: { kind: "video", mimeType: "video/quicktime" },
  webm: { kind: "video", mimeType: "video/webm" },
  wav: { kind: "audio", mimeType: "audio/wav" },
  mp3: { kind: "audio", mimeType: "audio/mpeg" },
  m4a: { kind: "audio", mimeType: "audio/mp4" },
  flac: { kind: "audio", mimeType: "audio/flac" },
};

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) return "";
  return filename.slice(dot + 1).toLowerCase();
}

export function mediaFormatFor(filename: string): MediaFormat | null {
  return MEDIA_FORMATS[extensionOf(filename)] ?? null;
}

export function extensionsFor(kind: AssetKind): string[] {
  return Object.entries(MEDIA_FORMATS)
    .filter(([, format]) => format.kind === kind)
    .map(([extension]) => extension);
}
