/**
 * Types shared by the render planner, the render worker, the engine and the
 * interface.
 *
 * A render plan is the complete, deterministic description of one video:
 * every scene's first frame and length, what it shows, every audio clip and
 * caption, all in whole frames. The same episode and settings always give the
 * same plan, and the composition draws only what the plan says.
 */
import { z } from "zod";
import { AnimationSpecSchema } from "./animation";
import { SceneCoverageSchema } from "./assembly";
import { AssetSchema } from "./domain";

const Frames = z.number().int().nonnegative();
const Timestamp = z.string();

/** Silence before a scene's narration starts. */
export const NARRATION_LEAD_SECONDS = 0.25;
/** Silence kept after narration before the scene may end. */
export const NARRATION_TAIL_SECONDS = 0.5;
/** Longest cross-fade between two scenes. */
export const FADE_SECONDS = 0.5;

/** The scene length a narration needs so that it is never cut. */
export function sceneSecondsForNarration(narrationSeconds: number): number {
  return NARRATION_LEAD_SECONDS + narrationSeconds + NARRATION_TAIL_SECONDS;
}

export const RENDER_RESOLUTIONS = {
  "1920x1080": { width: 1920, height: 1080 },
  "1280x720": { width: 1280, height: 720 },
} as const;
export type RenderResolution = keyof typeof RENDER_RESOLUTIONS;

export const RenderSettingsSchema = z.object({
  width: z.number().int().min(160).max(3840),
  height: z.number().int().min(90).max(2160),
  fps: z.union([z.literal(24), z.literal(25), z.literal(30)]),
  captions: z.enum(["none", "approximate"]),
});
export type RenderSettings = z.infer<typeof RenderSettingsSchema>;

export const ImageMotionSchema = z.enum([
  "static",
  "push_in",
  "pull_out",
  "pan_left",
  "pan_right",
  "tilt_up",
  "tilt_down",
  "handheld",
]);
export type ImageMotion = z.infer<typeof ImageMotionSchema>;

/** A media file the plan refers to. `src` is an absolute path until the
 * render worker replaces it with a URL it serves. */
const MediaRef = z.object({
  src: z.string().min(1),
  /** Content hash, so a plan's identity does not depend on where files are. */
  sha256: z.string(),
});

export const PlanVisualSchema = z.discriminatedUnion("kind", [
  MediaRef.extend({
    kind: z.literal("image"),
    motion: ImageMotionSchema,
  }),
  MediaRef.extend({
    kind: z.literal("video"),
    /** First frame of the clip to show: its trim. */
    startFrame: Frames.default(0),
    /**
     * Frames of the clip that play. When the shot is longer, the last one is
     * held for the rest, which happens only for a hold the user chose.
     */
    playFrames: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal("animation"),
    spec: AnimationSpecSchema,
    /** Mouth openness per scene frame (0..1), from the narration audio. */
    mouth: z.array(z.number().min(0).max(1)),
    /** The files of the animation's images, by key. */
    images: z
      .record(z.string(), z.object({ src: z.string(), sha256: z.string() }))
      .default({}),
  }),
  z.object({ kind: z.literal("none") }),
]);
export type PlanVisual = z.infer<typeof PlanVisualSchema>;

/** One stretch of a scene's picture: a clip, a still or its animation. */
export const PlanShotSchema = z.object({
  /** First frame, counted from the start of the scene. */
  from: Frames,
  durationInFrames: z.number().int().positive(),
  visual: PlanVisualSchema,
});
export type PlanShot = z.infer<typeof PlanShotSchema>;

export const PlanSceneSchema = z.object({
  sceneId: z.string(),
  index: z.number().int().nonnegative(),
  from: Frames,
  durationInFrames: z.number().int().positive(),
  /** Frames this scene fades in over the end of the previous one. 0 is a cut. */
  fadeInFrames: Frames,
  /** Back to back, covering the scene. Empty for a scene of text alone. */
  shots: z.array(PlanShotSchema),
  overlay: z
    .object({
      text: z.string().min(1),
      position: z.enum(["top", "center", "bottom"]),
    })
    .nullable(),
});
export type PlanScene = z.infer<typeof PlanSceneSchema>;

export const PlanAudioSchema = MediaRef.extend({
  kind: z.enum(["narration", "music"]),
  sceneId: z.string().nullable(),
  from: Frames,
  durationInFrames: z.number().int().positive(),
  volume: z.number().min(0).max(1),
  /** Music repeats to fill its length; narration never does. */
  loop: z.boolean(),
  fadeInFrames: Frames,
  fadeOutFrames: Frames,
});
export type PlanAudio = z.infer<typeof PlanAudioSchema>;

export const PlanCaptionSchema = z.object({
  from: Frames,
  durationInFrames: z.number().int().positive(),
  text: z.string().min(1),
});
export type PlanCaption = z.infer<typeof PlanCaptionSchema>;

export const RenderPlanSchema = z.object({
  version: z.literal(2),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().int().positive(),
  durationInFrames: z.number().int().positive(),
  scenes: z.array(PlanSceneSchema).min(1),
  audio: z.array(PlanAudioSchema),
  captions: z.array(PlanCaptionSchema),
  /** True when captions are timed by sentence length, not by the speech. */
  captionsApproximate: z.boolean(),
});
export type RenderPlan = z.infer<typeof RenderPlanSchema>;

/** Something the planner changed or could not do, said in a sentence. */
export const PlanNoticeSchema = z.object({
  sceneId: z.string().nullable(),
  severity: z.enum(["error", "warning"]),
  message: z.string(),
});
export type PlanNotice = z.infer<typeof PlanNoticeSchema>;

export const RenderPreviewSchema = z.object({
  /** Null when an error prevents rendering. */
  plan: RenderPlanSchema.nullable(),
  planHash: z.string().nullable(),
  durationSeconds: z.number().nonnegative(),
  notices: z.array(PlanNoticeSchema),
  /** How much of each scene has a picture, in scene order. */
  coverage: z.array(z.lazy(() => SceneCoverageSchema)).default([]),
});
export type RenderPreview = z.infer<typeof RenderPreviewSchema>;

/**
 * What the editor needs to play one scene's animation exactly as the render
 * will draw it: the same spec, its pictures and the mouth from the voice.
 */
export const AnimationPreviewSchema = z.object({
  animation: AnimationSpecSchema.nullable(),
  images: z.record(z.string(), AssetSchema),
  /** Mouth openness per output frame; empty when nothing is measured. */
  mouth: z.array(z.number()),
  fps: z.number().int().positive(),
  /** The scene's length in output frames, as the render would make it. */
  frames: z.number().int().nonnegative(),
});
export type AnimationPreview = z.infer<typeof AnimationPreviewSchema>;

// -------------------------------------------------------------- validation

export const OutputCheckSchema = z.object({
  label: z.string(),
  result: z.enum(["pass", "fail", "warning"]),
  detail: z.string(),
});
export type OutputCheck = z.infer<typeof OutputCheckSchema>;

export const MediaProbeSchema = z.object({
  durationSeconds: z.number().nonnegative().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  fps: z.number().nullable(),
  videoCodec: z.string().nullable(),
  audioCodec: z.string().nullable(),
  audioDurationSeconds: z.number().nullable(),
  sizeBytes: z.number().int().nonnegative(),
});
export type MediaProbe = z.infer<typeof MediaProbeSchema>;

export const OutputValidationSchema = z.object({
  passed: z.boolean(),
  checks: z.array(OutputCheckSchema),
  probe: MediaProbeSchema.nullable(),
  /** The program that inspected the file, e.g. "ffprobe 7.1". */
  inspector: z.string(),
});
export type OutputValidation = z.infer<typeof OutputValidationSchema>;

// ----------------------------------------------------------------- renders

export const RenderRecordSchema = z.object({
  id: z.string(),
  episodeId: z.string(),
  jobId: z.string().nullable(),
  /** Absolute path of the exported file. Owned by the user, never deleted. */
  path: z.string(),
  planHash: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  fps: z.number(),
  durationSeconds: z.number(),
  sizeBytes: z.number().int().nonnegative(),
  validation: OutputValidationSchema,
  createdAt: Timestamp,
  /** Whether the file was still there, with the same size, when listed. */
  fileStatus: z.enum(["present", "missing", "changed"]),
});
export type RenderRecord = z.infer<typeof RenderRecordSchema>;
