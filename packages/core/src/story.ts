/**
 * Story Architect: turning an original Video DNA concept into an editable
 * story draft, and the draft into a production project.
 *
 * Draft scenes use the production scene's own field names (title,
 * narrationText, cameraMotion, transition, overlayText, ...) so the hand-off
 * maps them one to one; the extra fields (claims, research references,
 * missing assets) stay with the draft as review material.
 */
import { z } from "zod";
import {
  CameraMotionSchema,
  IdSchema,
  SCENE_DURATION_MAX,
  SCENE_DURATION_MIN,
  TransitionSchema,
} from "./domain";
import { AnalysisEvidenceSchema } from "./research";
import { estimateNarrationSeconds } from "./script";

const Timestamp = z.string();

export const StorySettingsSchema = z.object({
  title: z.string().trim().min(1, "A working title is required").max(120),
  /** Up to two hours; long-form is generated section by section. */
  targetDurationSeconds: z.number().int().min(30).max(7200),
  language: z.string().trim().min(2).max(35),
  audience: z.string().max(300),
  tone: z.string().max(200),
  visualDirection: z.string().max(500),
  narrationStyle: z.string().max(200),
  /** Null lets the length of each section decide. */
  sceneCount: z.number().int().min(1).max(200).nullable(),
  /** For estimates only; real timing comes from the narration audio. */
  wordsPerMinute: z.number().int().min(80).max(260),
});
export type StorySettings = z.infer<typeof StorySettingsSchema>;

export const OutlineSectionSchema = z.object({
  id: z.string().min(1).max(40),
  title: z.string().max(160),
  purpose: z.string().max(600),
  keyPoints: z.array(z.string().max(300)).max(10),
  examples: z.array(z.string().max(300)).max(6),
  targetSeconds: z.number().min(5).max(3600),
});
export type OutlineSection = z.infer<typeof OutlineSectionSchema>;

export const StoryOutlineSchema = z.object({
  hook: z.string().max(800),
  premise: z.string().max(1200),
  centralQuestions: z.array(z.string().max(300)).max(8),
  sections: z.array(OutlineSectionSchema).max(40),
  ending: z.string().max(800),
});
export type StoryOutline = z.infer<typeof StoryOutlineSchema>;

export const STORY_SCENE_ORIGINS = ["ai", "user", "ai-edited"] as const;

export const StorySceneSchema = z.object({
  /** Stable for the life of the draft, across edits and regeneration. */
  id: IdSchema,
  sectionId: z.string().max(40),
  title: z.string().max(160),
  narrationText: z.string().max(10_000),
  visualDescription: z.string().max(4000),
  animationApproach: z.string().max(4000),
  cameraMotion: CameraMotionSchema,
  cameraInstructions: z.string().max(2000),
  overlayText: z.string().max(300),
  transition: TransitionSchema,
  productionNotes: z.string().max(2000),
  missingAssets: z.array(z.string().max(200)).max(10),
  /** Factual statements in the narration that need checking elsewhere. */
  claims: z.array(z.string().max(400)).max(10),
  /** Research the scene draws on. Reference material, not verification. */
  researchRefs: z.array(AnalysisEvidenceSchema).max(10),
  /** Set by the user; otherwise the estimate from the narration is used. */
  plannedSeconds: z
    .number()
    .min(SCENE_DURATION_MIN)
    .max(SCENE_DURATION_MAX)
    .nullable(),
  /** Approved scenes are never replaced by regeneration. */
  approved: z.boolean(),
  origin: z.enum(STORY_SCENE_ORIGINS),
});
export type StoryScene = z.infer<typeof StorySceneSchema>;

export const REVIEW_KINDS = [
  "originality-wording",
  "originality-structure",
  "fact-check",
  "duration",
  "incomplete",
  "model-output",
  "source-changed",
  /** A section far shorter or longer than its word budget. */
  "length",
  /** Sentences or facts that appear more than once. */
  "repetition",
  /** The model is not suited to the requested length. */
  "model-capacity",
] as const;

export const ReviewWarningSchema = z.object({
  id: z.string(),
  kind: z.enum(REVIEW_KINDS),
  /** "blocking" must be fixed before a project can be created. */
  severity: z.enum(["info", "warning", "blocking"]),
  sceneId: IdSchema.nullable(),
  message: z.string(),
});
export type ReviewWarning = z.infer<typeof ReviewWarningSchema>;

export const STORY_GENERATION_STATUSES = [
  "idle",
  "queued",
  "loading-model",
  "outline",
  "scenes",
  "validating",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
] as const;

export const StoryScopeSchema = z.discriminatedUnion("kind", [
  /** A new outline. Unapproved scenes are removed; approved ones stay. */
  z.object({ kind: z.literal("outline") }),
  /** Scenes for every section that has none. */
  z.object({ kind: z.literal("script") }),
  /** New scenes for one section; its approved scenes stay. */
  z.object({ kind: z.literal("section"), sectionId: z.string().max(40) }),
  /** One scene again, in place. */
  z.object({ kind: z.literal("scene"), sceneId: IdSchema }),
  /**
   * Lengthens a section's short scenes toward their word budget. Approved
   * scenes and scenes the user edited are left as they are.
   */
  z.object({ kind: z.literal("expand"), sectionId: z.string().max(40) }),
]);
export type StoryScope = z.infer<typeof StoryScopeSchema>;

export const StoryGenerationSchema = z.object({
  status: z.enum(STORY_GENERATION_STATUSES),
  scope: StoryScopeSchema.nullable(),
  jobId: IdSchema.nullable(),
  modelId: z.string().nullable(),
  runtime: z.string().nullable(),
  /** What the job is doing, in words. */
  step: z.string().nullable(),
  /** Problems with the model's output in the last run, per section. */
  problems: z.array(z.string()),
  /** The model that wrote in the last run, and whether it suits long scripts. */
  model: z
    .object({ name: z.string(), longForm: z.boolean() })
    .nullable()
    .default(null),
  error: z.string().nullable(),
  startedAt: Timestamp.nullable(),
  finishedAt: Timestamp.nullable(),
});
export type StoryGeneration = z.infer<typeof StoryGenerationSchema>;

/** The concept the draft started from, copied so it survives on its own. */
export const StoryConceptSchema = z.object({
  analysisId: IdSchema,
  itemId: z.string(),
  title: z.string(),
  premise: z.string(),
  angle: z.string(),
  audience: z.string(),
  durationMinutes: z.number().nullable(),
  visualDirection: z.string(),
  researchNeeded: z.array(z.string()),
  evidence: z.array(AnalysisEvidenceSchema),
});
export type StoryConcept = z.infer<typeof StoryConceptSchema>;

export const StoryHandoffSchema = z.object({
  productionProjectId: IdSchema,
  episodeId: IdSchema,
  /** Draft scene id → production scene id, in order. */
  scenes: z.array(z.object({ draftSceneId: IdSchema, sceneId: IdSchema })),
  revision: z.number().int(),
  createdAt: Timestamp,
});
export type StoryHandoff = z.infer<typeof StoryHandoffSchema>;

/** What the user edits and saves. */
export const StoryEditableSchema = z.object({
  settings: StorySettingsSchema,
  outline: StoryOutlineSchema.nullable(),
  scenes: z.array(StorySceneSchema).max(300),
});
export type StoryEditable = z.infer<typeof StoryEditableSchema>;

export const StoryDraftSchema = StoryEditableSchema.extend({
  id: IdSchema,
  researchProjectId: IdSchema,
  referenceVideoId: IdSchema,
  concept: StoryConceptSchema,
  /** Increases with every saved change; edits must name the one they saw. */
  revision: z.number().int().nonnegative(),
  /** The research data the concept's analysis read. */
  sourceFingerprint: z.string(),
  /** True when that research has changed since. */
  sourceChanged: z.boolean(),
  generation: StoryGenerationSchema,
  warnings: z.array(ReviewWarningSchema),
  /** Seconds the narration would take at the chosen speaking rate. */
  estimatedSeconds: z.number().nonnegative(),
  handoff: StoryHandoffSchema.nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type StoryDraft = z.infer<typeof StoryDraftSchema>;

export const StoryDraftSummarySchema = StoryDraftSchema.pick({
  id: true,
  referenceVideoId: true,
  revision: true,
  estimatedSeconds: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  title: z.string(),
  sceneCount: z.number().int(),
  status: z.enum(STORY_GENERATION_STATUSES),
  productionProjectId: IdSchema.nullable(),
});
export type StoryDraftSummary = z.infer<typeof StoryDraftSummarySchema>;

// ---------------------------------------------------------------- helpers

/** Words of narration a duration needs at a speaking rate. */
export function wordBudget(seconds: number, wordsPerMinute: number): number {
  return Math.round((seconds * wordsPerMinute) / 60);
}

/** The duration a draft scene gets in production. */
export function sceneSeconds(
  scene: Pick<StoryScene, "narrationText" | "plannedSeconds">,
  wordsPerMinute: number,
  fallbackSeconds: number,
): number {
  if (scene.plannedSeconds !== null) return scene.plannedSeconds;
  const estimate = estimateNarrationSeconds(
    scene.narrationText,
    wordsPerMinute,
  );
  const seconds =
    estimate > 0 ? Math.round(estimate * 10) / 10 : fallbackSeconds;
  return Math.min(SCENE_DURATION_MAX, Math.max(SCENE_DURATION_MIN, seconds));
}
