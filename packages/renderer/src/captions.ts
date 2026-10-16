/**
 * Scene-level captions timed by sentence length.
 *
 * These are approximate by design: each sentence is shown for a share of the
 * narration proportional to its length in characters, which is not when it
 * is actually spoken. The interface labels them as approximate. Exact,
 * word-level timing needs alignment against the audio, which is not built.
 */
import type { PlanCaption } from "@framebop/core";

/** Characters per caption line, and lines per caption. */
const LINE_CHARS = 42;
const MAX_LINES = 2;

export function splitSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  return (
    normalized
      .match(/[^.!?]+(?:[.!?]+["”’')\]]*|$)/g)
      ?.map((sentence) => sentence.trim())
      .filter(Boolean) ?? [normalized]
  );
}

/** Breaks a sentence into pieces that fit MAX_LINES lines of LINE_CHARS. */
export function captionPieces(sentence: string): string[] {
  const limit = LINE_CHARS * MAX_LINES;
  const words = sentence.split(" ");
  const pieces: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > limit && current) {
      pieces.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

export function approximateCaptions(
  text: string,
  startFrame: number,
  lengthInFrames: number,
): PlanCaption[] {
  const pieces = splitSentences(text).flatMap(captionPieces);
  const totalChars = pieces.reduce((sum, piece) => sum + piece.length, 0);
  if (pieces.length === 0 || totalChars === 0) return [];

  const captions: PlanCaption[] = [];
  let consumed = 0;
  let from = startFrame;
  for (const piece of pieces) {
    consumed += piece.length;
    // Boundaries come from the running total, so rounding never drifts.
    const end =
      startFrame + Math.round((consumed / totalChars) * lengthInFrames);
    if (end > from) {
      captions.push({ from, durationInFrames: end - from, text: piece });
      from = end;
    }
  }
  return captions;
}
