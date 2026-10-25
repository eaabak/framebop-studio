/**
 * The AI Animation Director's contract: an animation blueprint, the plan of
 * one short educational animation in data (never code). A language model
 * drafts it from an idea; the renderer's capability registry checks it,
 * normalizes it and builds the animation from it. Only capabilities the
 * renderer knows can be planned.
 */
import { z } from "zod";
import { ArtDirectionSchema } from "./direction";
import { LabCameraSchema, LabStyleSchema } from "./lab";

/** What the renderer can build. Each has its own parameters and checks. */
export const ANIMATION_CAPABILITIES = [
  "brachistochrone",
  "muller-lyer",
  "point-light-shadow",
] as const;
export const AnimationCapabilitySchema = z.enum(ANIMATION_CAPABILITIES);
export type AnimationCapability = z.infer<typeof AnimationCapabilitySchema>;

export const BLUEPRINT_BEATS = [
  "hook",
  "prediction",
  "experiment",
  "reveal",
  "explanation",
  "closing",
] as const;
export const BlueprintBeatSchema = z.enum(BLUEPRINT_BEATS);
export type BlueprintBeat = z.infer<typeof BlueprintBeatSchema>;

const Line = (max: number) => z.string().trim().min(1).max(max);

/** One scene of the plan: a beat of the story and how long it lasts. */
export const AnimationSceneSchema = z.object({
  beat: BlueprintBeatSchema,
  seconds: z.number().min(0.5).max(20),
  /** What happens, in a sentence, for the person reviewing the plan. */
  note: z.string().max(240).default(""),
});
export type AnimationScene = z.infer<typeof AnimationSceneSchema>;

export const AnimationBlueprintSchema = z.object({
  version: z.literal(1),
  /** The idea it was planned from, as the user wrote it. */
  idea: z.string().max(1000).default(""),
  capability: AnimationCapabilitySchema,
  concept: z.object({
    title: Line(80),
    objective: Line(300),
    audience: Line(120),
    hook: Line(200),
  }),
  /** The language of the words in the video, such as "en" or "tr". */
  language: z.string().min(2).max(12),
  /** Words on screen. Short, so they read on a phone. */
  text: z.object({
    hook: Line(48),
    prediction: Line(48),
    explanation: Line(48),
    closing: Line(48),
    /** Names of the two things compared, as their labels show them. */
    labels: z.tuple([Line(20), Line(20)]),
  }),
  /** The story in order. Which beats a capability uses is its own. */
  scenes: z.array(AnimationSceneSchema).min(3).max(6),
  style: LabStyleSchema,
  camera: LabCameraSchema,
  /**
   * How it looks and moves: a style and any options set on top of it. Only
   * capabilities with compositions take it; the others have a fixed look.
   */
  direction: ArtDirectionSchema.default({ style: "educational" }),
  audio: z
    .object({ mood: z.enum(["bright", "calm", "tense"]).default("bright") })
    .default({ mood: "bright" }),
  /** The capability's own numbers, by name; see its parameter list. */
  parameters: z.record(z.string().max(40), z.number()).default({}),
  /** What the experiment assumes, as the capability states it. */
  assumptions: z.array(z.string().max(120)).max(6).default([]),
});
export type AnimationBlueprint = z.infer<typeof AnimationBlueprintSchema>;

/** A parameter a capability accepts, with its limits. */
export const CapabilityParameterSchema = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string(),
  min: z.number(),
  max: z.number(),
  step: z.number(),
  default: z.number(),
  unit: z.string().default(""),
});
export type CapabilityParameter = z.infer<typeof CapabilityParameterSchema>;

/** What the interface and the planner learn about a capability. */
export const CapabilityInfoSchema = z.object({
  id: AnimationCapabilitySchema,
  name: z.string(),
  summary: z.string(),
  parameters: z.array(CapabilityParameterSchema),
  beats: z.array(
    z.object({
      beat: BlueprintBeatSchema,
      min: z.number(),
      max: z.number(),
      /** The length is decided by the simulation, not chosen. */
      fixed: z.boolean().default(false),
    }),
  ),
  assumptions: z.array(z.string()),
  /**
   * Ways the capability can be composed on screen, which art direction
   * chooses between, and which parameters each uses. Empty for capabilities
   * with one fixed look, which art direction does not change.
   */
  compositions: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        summary: z.string(),
        parameters: z.array(z.string()),
      }),
    )
    .default([]),
});
export type CapabilityInfo = z.infer<typeof CapabilityInfoSchema>;

/** Something normalizing or checking a blueprint changed or found. */
export const DirectorNoticeSchema = z.object({
  severity: z.enum(["info", "warning"]),
  message: z.string(),
});
export type DirectorNotice = z.infer<typeof DirectorNoticeSchema>;

export const QUALITY_CATEGORIES = [
  "schema",
  "structure",
  "science",
  "text",
  "numbers",
  "capability",
  "layout",
  "contrast",
  "readability",
] as const;
export const QualityCategorySchema = z.enum(QUALITY_CATEGORIES);

/**
 * One thing found wrong (an error) or worth a look (a warning) in a plan.
 * Errors stand for output that would be broken or untrue and block the
 * build; warnings never block. A fix is offered when one is safe to name;
 * `applied` says it was already made (and so is shown, not hidden).
 */
export const QualityFindingSchema = z.object({
  /** Stable for the same problem in the same place, to avoid repeats. */
  id: z.string(),
  severity: z.enum(["error", "warning"]),
  category: QualityCategorySchema,
  /** The beat of the story it concerns, if one. */
  scene: BlueprintBeatSchema.nullable().default(null),
  /** What it concerns: "text.closing", "style.secondary", "label.0"... */
  element: z.string().nullable().default(null),
  message: z.string(),
  suggestion: z.string().default(""),
  fix: z
    .object({
      /** A plan field as a dotted path, such as "text.closing". */
      field: z.string(),
      value: z.string(),
      applied: z.boolean(),
    })
    .nullable()
    .default(null),
});
export type QualityFinding = z.infer<typeof QualityFindingSchema>;

/** Mobile-first rules the checks use, for a 1080 × 1920 picture. */
export const QualityRulesSchema = z.object({
  safeTop: z.number().default(200),
  safeBottom: z.number().default(1540),
  safeLeft: z.number().default(70),
  safeRight: z.number().default(960),
  /** Smallest text, in picture pixels, that still reads on a phone. */
  minTextPx: z.number().default(24),
  /** Smallest essential object (a sphere's radius, a line's width). */
  minObjectPx: z.number().default(12),
  /** WCAG contrast ratio of accents against the background. */
  minContrast: z.number().default(3),
  /** Most words on screen at once before it reads as clutter. */
  maxOverlays: z.number().int().default(6),
  maxTitleLines: z.number().int().default(3),
});
export type QualityRules = z.infer<typeof QualityRulesSchema>;

export const QualityReportSchema = z.object({
  status: z.enum(["pass", "warnings", "errors"]),
  findings: z.array(QualityFindingSchema),
  /** Which checks ran, so a pass is never mistaken for more than it is. */
  checks: z.array(z.string()),
});
export type QualityReport = z.infer<typeof QualityReportSchema>;

export const DirectorResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("planned"),
    blueprint: AnimationBlueprintSchema,
    notices: z.array(DirectorNoticeSchema),
    quality: QualityReportSchema,
    /** Model attempts it took to get a valid plan. */
    attempts: z.number().int().positive(),
  }),
  z.object({
    status: z.literal("unsupported"),
    /** Why, in the model's words, checked against what exists. */
    reason: z.string(),
    capabilities: z.array(CapabilityInfoSchema),
  }),
]);
export type DirectorResult = z.infer<typeof DirectorResultSchema>;
