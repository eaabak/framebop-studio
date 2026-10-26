/** The bounded LTX preset for Apple Silicon; no automatic downloads. */
export const LTX_VIDEO_ENGINE = "ltx-2-mlx";
export const LTX_VIDEO_MODEL = "ltx-2.3-mlx-q4";
export const LTX_TEXT_ENCODER_MODEL = "gemma-3-12b-ltx-q4";
export const LTX_VIDEO_FPS = 24;
export const LTX_MAX_SECONDS = 10;
export const LTX_VIDEO_SIZES = [
  { width: 1024, height: 576 },
  { width: 1280, height: 704 },
  { width: 1408, height: 768 },
  { width: 640, height: 384 },
  { width: 768, height: 512 },
] as const;

/** Generate on the 8n+1 grid, then trim to the requested display duration. */
export function ltxFrameCounts(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > LTX_MAX_SECONDS) {
    throw new Error(
      `LTX clip length must be between 1 and ${LTX_MAX_SECONDS} seconds.`,
    );
  }
  const outputFrames = Math.round(seconds * LTX_VIDEO_FPS);
  return {
    outputFrames,
    generatedFrames: Math.ceil((outputFrames - 1) / 8) * 8 + 1,
    actualSeconds: outputFrames / LTX_VIDEO_FPS,
  };
}
