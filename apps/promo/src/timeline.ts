/**
 * The promo at 30 fps. Parts follow each other with a short crossfade
 * (OVERLAP frames). The app part is one window on a stage: recordings play
 * inside it one after another while the camera moves, so nothing cuts to
 * black between steps. The voice-over is placed on the whole timeline, line
 * after line, and the visuals are paced to it.
 */
export const FPS = 30;
export const OVERLAP = 9;

/** A piece of a recording: seconds in the file, sped up by `rate`. */
export type Cut = {
  src: string;
  from: number;
  to: number;
  rate?: number;
  fadeIn?: boolean;
};
/** Where the camera looks: the window's point at the centre (0 to 1), at a frame. */
export type Shot = { at: number; scale: number; x: number; y: number };
/** Something shown from a frame of the stage until the next one starts. */
export type Cue = { at: number; n?: number; label: string; caption: string };

export type Part =
  | { kind: "intro" | "promise" | "noNeeds" | "outro"; frames: number }
  | { kind: "stage"; frames: number }
  | { kind: "finished"; frames: number; src: string };

export const cutFrames = (cut: Cut) =>
  Math.round(((cut.to - cut.from) / (cut.rate ?? 1)) * FPS);

const rec = (name: string) => `rec/${name}.mp4`;

// ---------- The app, on one stage (frames are local to the stage) ----------

export const STAGE_CUTS: Cut[] = [
  // 1 · Script: type the idea, wait for the draft, use it.
  { src: rec("02-script"), from: 0.6, to: 5.4, rate: 3 },
  { src: rec("02-script"), from: 5.4, to: 11.2, rate: 15 },
  { src: rec("02-script"), from: 11.2, to: 15.2, rate: 2 },
  // 2 · Scenes.
  { src: rec("03-scenes"), from: 1.2, to: 4.2, rate: 1.3, fadeIn: true },
  // A picture for the first scene.
  { src: rec("04-picture"), from: 0.3, to: 6.9, rate: 4.4, fadeIn: true },
  { src: rec("04-picture"), from: 6.9, to: 32.8, rate: 30 },
  { src: rec("04-picture"), from: 32.8, to: 34.1 },
  // Its voice.
  { src: rec("05-voice"), from: 1.3, to: 2.6, rate: 1.3, fadeIn: true },
  { src: rec("05-voice"), from: 2.6, to: 11.6, rate: 20 },
  { src: rec("05-voice"), from: 11.6, to: 12.2 },
  // 3 · Video: make it, then into the player.
  { src: rec("07-export"), from: 0.9, to: 2.4, rate: 1.25, fadeIn: true },
  { src: rec("07-export"), from: 2.4, to: 22.0, rate: 25 },
  { src: rec("07-export"), from: 22.0, to: 23.9 },
];

export const STAGE_FRAMES = STAGE_CUTS.reduce(
  (sum, cut) => sum + cutFrames(cut),
  0,
);

export const STAGE_SHOTS: Shot[] = [
  { at: 0, scale: 1.0, x: 0.5, y: 0.5 },
  { at: 18, scale: 1.7, x: 0.86, y: 0.66 },
  { at: 92, scale: 1.7, x: 0.86, y: 0.62 },
  { at: 116, scale: 1.15, x: 0.42, y: 0.5 },
  { at: 126, scale: 1.5, x: 0.86, y: 0.34 },
  { at: 150, scale: 1.0, x: 0.5, y: 0.5 },
  { at: 192, scale: 1.0, x: 0.5, y: 0.5 },
  { at: 204, scale: 1.6, x: 0.86, y: 0.32 },
  { at: 258, scale: 1.6, x: 0.86, y: 0.34 },
  { at: 278, scale: 1.45, x: 0.42, y: 0.33 },
  { at: 300, scale: 1.45, x: 0.42, y: 0.33 },
  { at: 310, scale: 1.6, x: 0.86, y: 0.58 },
  { at: 340, scale: 1.6, x: 0.86, y: 0.58 },
  { at: 354, scale: 1.25, x: 0.45, y: 0.86 },
  { at: 362, scale: 1.25, x: 0.45, y: 0.86 },
  { at: 377, scale: 1.45, x: 0.585, y: 0.3 },
  { at: 424, scale: 1.45, x: 0.585, y: 0.3 },
  { at: 446, scale: 1.15, x: 0.586, y: 0.52 },
  // The in-app player grows until it fills the frame.
  { at: STAGE_FRAMES, scale: 2.38, x: 0.586, y: 0.557 },
];

/**
 * The same moves in a tall (9:16) frame for Reels and TikTok. The window is
 * shown a little smaller, so more of it fits the narrow frame; at the end
 * the player fills the frame's width, where the finished video picks up.
 */
export const TALL_ZOOM = 0.95;
export const STAGE_SHOTS_TALL: Shot[] = STAGE_SHOTS.map((shot, i) => ({
  ...shot,
  scale: shot.scale * (i === STAGE_SHOTS.length - 1 ? 1080 / 1920 : TALL_ZOOM),
}));

export const STAGE_CUES: Cue[] = [
  {
    at: 0,
    n: 1,
    label: "Script",
    caption: "Start with an idea. A local AI drafts the script.",
  },
  {
    at: 120,
    n: 2,
    label: "Scenes",
    caption: "Every paragraph becomes a scene.",
  },
  {
    at: 189,
    label: "Pictures, made with AI",
    caption: "Each scene gets a picture, made on your Mac.",
  },
  {
    at: 299,
    label: "A voice for every scene",
    caption: "And a voice that reads it aloud.",
  },
  {
    at: 361,
    n: 3,
    label: "Video",
    caption: "Then Framebop renders the finished video.",
  },
];

// ---------- The whole video ----------

export const PARTS: Part[] = [
  { kind: "intro", frames: 78 },
  { kind: "promise", frames: 129 },
  { kind: "stage", frames: STAGE_FRAMES },
  // Long enough for the first sentence of its narration (it ends at 4.4 s).
  { kind: "finished", frames: 141, src: "demo/lighthouse.mp4" },
  { kind: "noNeeds", frames: 111 },
  { kind: "outro", frames: 190 },
];

/** Where each part starts on the whole timeline. */
export const PART_STARTS = PARTS.reduce<number[]>((starts, part, i) => {
  const prev = PARTS[i - 1];
  starts.push(i === 0 || !prev ? 0 : starts[i - 1]! + prev.frames - OVERLAP);
  return starts;
}, []);

export const TOTAL_FRAMES = PART_STARTS.at(-1)! + PARTS.at(-1)!.frames;

const partStart = (kind: Part["kind"]) =>
  PART_STARTS[PARTS.findIndex((p) => p.kind === kind)]!;
const stageStart = partStart("stage");
const cueStart = (i: number) => stageStart + STAGE_CUES[i]!.at;

/**
 * Voice-over lines on the whole timeline. Inside the stage, lines start a
 * little before their step (the sound leads the picture), so the narration
 * runs on without stopping at each change.
 */
export const VOICE: { src: string; at: number }[] = [
  { src: "vo/vo-01.wav", at: partStart("intro") + 15 },
  { src: "vo/vo-02.wav", at: partStart("promise") + 9 },
  { src: "vo/vo-03.wav", at: cueStart(0) + 8 },
  { src: "vo/vo-04.wav", at: cueStart(1) - 10 },
  { src: "vo/vo-05.wav", at: cueStart(2) - 10 },
  { src: "vo/vo-06.wav", at: cueStart(3) - 16 },
  { src: "vo/vo-07.wav", at: cueStart(4) + 4 },
  { src: "vo/vo-08.wav", at: partStart("noNeeds") + 10 },
  { src: "vo/vo-09.wav", at: partStart("outro") + 12 },
];
