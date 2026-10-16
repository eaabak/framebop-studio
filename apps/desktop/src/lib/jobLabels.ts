import { type TranslationKey, t } from "../i18n";

/**
 * A job's label in the interface language. The engine names jobs in English
 * with fixed patterns ("Import clip.mp4", "Render “Title” · 1920×1080"); the
 * pattern is translated and the names inside it are kept. A label that fits
 * no known pattern is shown as the engine wrote it.
 */
const SCOPES: Record<string, TranslationKey> = {
  outline: "jobs:scopeOutline",
  script: "jobs:scopeScript",
  "one section": "jobs:scopeSection",
  "lengthen a section": "jobs:scopeLengthen",
  "one scene": "jobs:scopeScene",
};

const PATTERNS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^Import music (.+)$/, (m) => t("jobs:labelImportMusic", { name: m[1] })],
  [/^Import (.+)$/, (m) => t("jobs:labelImport", { name: m[1] })],
  [
    /^Render “(.+)” · (\d+×\d+)$/,
    (m) => t("jobs:labelRender", { title: m[1], size: m[2] }),
  ],
  [
    /^Generate image · (.+)$/,
    (m) => t("jobs:labelGenerateImage", { engine: m[1] }),
  ],
  [
    /^Generate clip · (.+)$/,
    (m) => t("jobs:labelGenerateClip", { engine: m[1] }),
  ],
  [
    /^Generate narration · (.+)$/,
    (m) => t("jobs:labelGenerateNarration", { engine: m[1] }),
  ],
  [
    /^Video DNA analysis: (.+)$/,
    (m) => t("jobs:labelAnalysis", { title: m[1] }),
  ],
  [
    /^Story draft: (.+) \((outline|script|one section|lengthen a section|one scene)\)$/,
    (m) => t("jobs:labelStory", { title: m[1], scope: t(SCOPES[m[2]!]!) }),
  ],
  [
    /^Longer narration: (.+)$/,
    (m) => t("jobs:labelLongerNarration", { title: m[1] }),
  ],
];

export function jobLabel(label: string): string {
  for (const [pattern, translate] of PATTERNS) {
    const match = label.match(pattern);
    if (match) return translate(match);
  }
  return label;
}

/** Progress messages the engines write, by their fixed English text. */
const FIXED_PROGRESS: Record<string, TranslationKey> = {
  "Loading the model": "jobs:progressLoadingModel",
  "Loading the voice": "jobs:progressLoadingVoice",
  "Loading Kokoro": "jobs:progressLoadingVoice",
  Speaking: "jobs:progressSpeaking",
  "Encoding the clip": "jobs:progressEncodingClip",
  "Preparing the pattern": "jobs:progressPreparing",
  "Starting the renderer": "jobs:progressStartingRenderer",
  "Writing the MP4 file": "jobs:progressWritingVideo",
  "Checking the scenes' media": "jobs:progressCheckingMedia",
  "Checking the video": "jobs:progressCheckingVideo",
  "Saving the video": "jobs:progressSavingVideo",
  Copying: "jobs:progressCopying",
  Analysing: "jobs:progressAnalysing",
  "Loading the language model": "jobs:progressLoadingLanguageModel",
  Validating: "jobs:progressValidating",
  "Writing a longer narration": "jobs:progressLongerNarration",
  "Planning the outline": "jobs:progressPlanningOutline",
  "Reviewing the draft": "jobs:progressReviewingDraft",
};

const COUNTED_PROGRESS: [RegExp, TranslationKey][] = [
  [/^Step (\d+) of (\d+)$/, "jobs:progressStep"],
  [/^Rendered (\d+) of (\d+) frames$/, "jobs:progressFrames"],
  [/^Spoke sentence (\d+) of (\d+)$/, "jobs:progressSentence"],
];

/** A job's progress message in the interface language, when it is known. */
export function progressText(message: string): string {
  const fixed = FIXED_PROGRESS[message];
  if (fixed) return t(fixed);
  for (const [pattern, key] of COUNTED_PROGRESS) {
    const match = message.match(pattern);
    if (match) return t(key, { done: match[1], total: match[2] });
  }
  return message;
}

/** Engine settings the interface knows, in plain words. */
const PARAMETERS: Record<string, [TranslationKey, TranslationKey]> = {
  steps: ["jobs:paramSteps", "jobs:paramStepsHint"],
  cfgScale: ["jobs:paramGuidance", "jobs:paramGuidanceHint"],
  sampler: ["jobs:paramSampler", "jobs:paramSamplerHint"],
  voice: ["jobs:paramVoice", "jobs:paramVoiceHint"],
  speed: ["jobs:paramSpeed", "jobs:paramSpeedHint"],
};

/** A setting's name and help in the interface language. */
export function parameterText(spec: {
  key: string;
  label: string;
  description?: string | undefined;
}): {
  label: string;
  hint: string | undefined;
} {
  const known = PARAMETERS[spec.key];
  return known
    ? { label: t(known[0]), hint: t(known[1]) }
    : { label: spec.label, hint: spec.description };
}

/** "Scene 3" or "Scene 3, shot 2", as the render planner names places. */
function placeText(place: string): string {
  const match = place.match(/^Scene (\d+)(?:, shot (\d+))?$/);
  if (!match) return place;
  return match[2]
    ? t("jobs:noticeShot", { scene: match[1], shot: match[2] })
    : t("jobs:noticeScene", { scene: match[1] });
}

const NOTICES: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^The episode has no scenes\.$/, () => t("jobs:noticeNoScenes")],
  [
    /^The episode's background music is missing from the library\.$/,
    () => t("jobs:noticeMusicMissing"),
  ],
  [
    /^(Scene \d+) has no image, clip or overlay text, so it would be an empty black screen\.$/,
    (m) => t("jobs:noticeEmpty", { place: placeText(m[1]!) }),
  ],
  [
    /^(Scene \d+) is lengthened from ([\d.]+) s to ([\d.]+) s so its narration is not cut\.$/,
    (m) =>
      t("jobs:noticeLengthened", {
        place: placeText(m[1]!),
        from: m[2],
        to: m[3],
      }),
  ],
  [
    /^(Scene \d+): ([\d.]+) s of its ([\d.]+) s have no picture\./,
    (m) =>
      t("jobs:noticeGap", {
        place: placeText(m[1]!),
        gap: m[2],
        total: m[3],
      }),
  ],
  [
    /^(Scene \d+(?:, shot \d+)?): its (?:picture or clip|narration file) is missing from the library\.$/,
    (m) => t("jobs:noticeFileMissing", { place: placeText(m[1]!) }),
  ],
  [
    /^(Scene \d+): "(.+)" needs a video clip\. The still is shown without movement\.$/,
    (m) => t("jobs:noticeNeedsClip", { place: placeText(m[1]!) }),
  ],
];

/** A render-plan notice in the interface language, when it is known. */
export function noticeText(message: string): string {
  for (const [pattern, translate] of NOTICES) {
    const match = message.match(pattern);
    if (match) return translate(match);
  }
  return message;
}
