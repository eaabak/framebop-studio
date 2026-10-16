export interface SceneDraft {
  title: string;
  narrationText: string;
  durationSeconds: number;
}

export interface SplitOptions {
  wordsPerMinute: number;
  /** Lower bound for a scene's duration, in seconds. */
  minSeconds?: number;
  /** Upper bound for a scene's duration, in seconds. */
  maxSeconds?: number;
}

export function countWords(text: string): number {
  const matches = text.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

/** Spoken length of `text` at a steady reading pace. An estimate, not a measurement. */
export function estimateNarrationSeconds(
  text: string,
  wordsPerMinute: number,
): number {
  if (wordsPerMinute <= 0) return 0;
  return (countWords(text) / wordsPerMinute) * 60;
}

const HEADING = /^#{1,6}\s+(.+)$/;
const SCENE_LABEL = /^(?:scene|shot)\s+\d+\s*[:.\-–—]\s*(.+)$/i;

function headingOf(paragraph: string): string | null {
  if (paragraph.includes("\n")) return null;
  const match = HEADING.exec(paragraph) ?? SCENE_LABEL.exec(paragraph);
  return match?.[1]?.trim() ?? null;
}

function titleFromNarration(narration: string): string {
  const words = narration.split(/\s+/);
  const head = words
    .slice(0, 6)
    .join(" ")
    .replace(/[.,;:!?]+$/, "");
  return words.length > 6 ? `${head}…` : head;
}

function roundToHalf(seconds: number): number {
  return Math.round(seconds * 2) / 2;
}

/**
 * Deterministically splits a script into one scene per paragraph. A paragraph
 * that is only a Markdown heading or a "Scene 3: Title" label names the scene
 * that follows instead of becoming narration. No language model is involved.
 */
export function splitScriptIntoScenes(
  script: string,
  options: SplitOptions,
): SceneDraft[] {
  const minSeconds = options.minSeconds ?? 2;
  const maxSeconds = options.maxSeconds ?? 600;
  const paragraphs = script
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  const drafts: SceneDraft[] = [];
  let pendingTitle: string | null = null;

  for (const paragraph of paragraphs) {
    const heading = headingOf(paragraph);
    if (heading !== null) {
      pendingTitle = heading;
      continue;
    }
    const narrationText = paragraph.replace(/\s*\n\s*/g, " ");
    const estimate = estimateNarrationSeconds(
      narrationText,
      options.wordsPerMinute,
    );
    drafts.push({
      title: (pendingTitle ?? titleFromNarration(narrationText)).slice(0, 160),
      narrationText,
      durationSeconds: Math.min(
        maxSeconds,
        Math.max(minSeconds, roundToHalf(estimate)),
      ),
    });
    pendingTitle = null;
  }

  return drafts;
}
