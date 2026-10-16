/**
 * Production Blueprint: an editable production plan for every scene of an
 * episode, and a preflight that says what is actually ready.
 *
 * A plan names how the scene's picture will be made, with which engine and
 * model, what assets it needs, and the facts to check that came with its
 * story draft. Methods are offered only as far as an engine in this build
 * can perform them, and the preflight separates technical problems (which
 * stop production) from editorial ones (which a person reviews).
 */
import { z } from "zod";
import { AnimationSpecSchema } from "./animation";
import { SceneShotsSchema } from "./assembly";
import { IdSchema } from "./domain";
import { AnalysisEvidenceSchema } from "./research";

const Timestamp = z.string();

export const PRODUCTION_METHODS = [
  "static-image",
  "layered-2d",
  "video-clip",
  "image-generation",
  "image-to-video",
] as const;
export const ProductionMethodSchema = z.enum(PRODUCTION_METHODS);
export type ProductionMethod = z.infer<typeof ProductionMethodSchema>;

export const PRODUCTION_METHOD_LABELS: Record<ProductionMethod, string> = {
  "static-image": "Still image with camera motion",
  "layered-2d": "Layered 2D animation",
  "video-clip": "Existing video clip",
  "image-generation": "Generated image",
  "image-to-video": "Generated video from an image",
};

/** Where a scene's duration came from. */
export const DURATION_SOURCES = ["estimate", "manual", "audio"] as const;

export const ScenePlanSchema = z.object({
  sceneId: IdSchema,
  method: ProductionMethodSchema,
  /** Engine chosen for generated methods. */
  engineId: z.string().max(80).nullable(),
  model: z.string().max(1024).nullable(),
  requiredAssets: z.array(z.string().max(200)).max(20),
  /** Facts to check, carried over from the story draft. */
  claims: z.array(z.string().max(400)).max(20),
  /** Research the scene drew on. Reference material, not verification. */
  research: z.array(AnalysisEvidenceSchema).max(20),
  durationSource: z.enum(DURATION_SOURCES),
  notes: z.string().max(2000),
  /** A longer narration suggested by the language model, not yet accepted. */
  proposedNarration: z.string().max(10_000).nullable(),
  proposalJobId: IdSchema.nullable(),
  storyDraftId: IdSchema.nullable(),
  draftSceneId: IdSchema.nullable(),
  /** The 2D animation the layered-2d method renders. */
  animation: AnimationSpecSchema.nullable().default(null),
  /** Characters, places and styles this scene shares with others. */
  visualReferenceIds: z.array(IdSchema).max(12).default([]),
  /**
   * The clips and stills the scene shows, in order. Empty: the clip or still
   * in its media slots.
   */
  shots: SceneShotsSchema.default([]),
  /** Subtitle text in place of the narration text. Null: the narration. */
  captionText: z.string().max(10_000).nullable().default(null),
  updatedAt: Timestamp,
});
export type ScenePlan = z.infer<typeof ScenePlanSchema>;

export const VISUAL_REFERENCE_KINDS = [
  "character",
  "environment",
  "style",
] as const;
export const VisualReferenceKindSchema = z.enum(VISUAL_REFERENCE_KINDS);
export type VisualReferenceKind = z.infer<typeof VisualReferenceKindSchema>;

/**
 * A character, place or style that several scenes share. Every generation
 * for a linked scene carries its words in the prompt, and its approved
 * pictures are offered as the starting image. That makes requests consistent;
 * it does not make the model keep a character the same.
 */
export const VisualReferenceSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  kind: VisualReferenceKindSchema,
  name: z.string().trim().min(1).max(80),
  /** Who or what it is, in words a model can follow. */
  description: z.string().max(1000),
  palette: z.string().max(300),
  /** Approved pictures of it, from the project's library. */
  assetIds: z.array(IdSchema).max(8),
  /** A seed to reuse with it, for engines that take one. */
  seed: z.number().int().min(0).max(4_294_967_295).nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type VisualReference = z.infer<typeof VisualReferenceSchema>;

export const VisualReferenceSaveSchema = z.strictObject({
  projectId: IdSchema,
  /** Null to create a new reference. */
  id: IdSchema.nullable().default(null),
  kind: VisualReferenceKindSchema,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(1000).default(""),
  palette: z.string().trim().max(300).default(""),
  assetIds: z.array(IdSchema).max(8).default([]),
  seed: z.number().int().min(0).max(4_294_967_295).nullable().default(null),
});

/**
 * The prompt an engine receives for a scene: the scene's own prompt followed
 * by what its references say. Shown to the user before a run, unchanged.
 */
export function composeGenerationPrompt(
  scenePrompt: string,
  references: readonly Pick<
    VisualReference,
    "kind" | "name" | "description" | "palette"
  >[],
): string {
  const order: Record<VisualReferenceKind, number> = {
    character: 0,
    environment: 1,
    style: 2,
  };
  const parts = [scenePrompt.trim()];
  for (const reference of [...references].sort(
    (a, b) => order[a.kind] - order[b.kind],
  )) {
    const description = reference.description.trim();
    if (description) {
      parts.push(
        reference.kind === "style"
          ? `Style: ${description}`
          : `${reference.name}: ${description}`,
      );
    }
    if (reference.palette.trim()) {
      parts.push(`Palette: ${reference.palette.trim()}`);
    }
  }
  return parts.filter(Boolean).join(". ");
}

export const ScenePlanPatchSchema = z
  .strictObject({
    method: ProductionMethodSchema,
    engineId: z.string().max(80).nullable(),
    model: z.string().max(1024).nullable(),
    requiredAssets: z.array(z.string().trim().min(1).max(200)).max(20),
    claims: z.array(z.string().trim().min(1).max(400)).max(20),
    notes: z.string().max(2000),
    animation: AnimationSpecSchema.nullable(),
    visualReferenceIds: z.array(IdSchema).max(12),
    shots: SceneShotsSchema,
    captionText: z.string().max(10_000).nullable(),
  })
  .partial();
export type ScenePlanPatch = z.infer<typeof ScenePlanPatchSchema>;

export const MethodAvailabilitySchema = z.object({
  method: ProductionMethodSchema,
  label: z.string(),
  available: z.boolean(),
  reason: z.string(),
  /** Engines that perform it, with their real state. */
  engines: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      available: z.boolean(),
      maturity: z.string(),
      reason: z.string().nullable(),
    }),
  ),
});
export type MethodAvailability = z.infer<typeof MethodAvailabilitySchema>;

export const BlueprintSceneSchema = z.object({
  sceneId: IdSchema,
  index: z.number().int(),
  title: z.string(),
  narrationText: z.string(),
  visualDescription: z.string(),
  motionPrompt: z.string(),
  cameraMotion: z.string(),
  transition: z.string(),
  durationSeconds: z.number(),
  plan: ScenePlanSchema,
  narration: z.object({
    words: z.number().int(),
    /** At the speaking rate in settings. An estimate. */
    estimatedSeconds: z.number(),
    /** Measured from the scene's narration audio, when it has one. */
    measuredSeconds: z.number().nullable(),
    /** A finished narration preview not yet put in the scene. */
    previewJobId: IdSchema.nullable(),
    previewSeconds: z.number().nullable(),
  }),
  media: z.object({
    image: z.boolean(),
    video: z.boolean(),
    audio: z.boolean(),
  }),
});
export type BlueprintScene = z.infer<typeof BlueprintSceneSchema>;

export const BlueprintSchema = z.object({
  projectId: IdSchema,
  episodeId: IdSchema,
  targetSeconds: z.number(),
  wordsPerMinute: z.number().int(),
  plannedSeconds: z.number(),
  estimatedNarrationSeconds: z.number(),
  /** Sum over scenes with narration audio; null when none has any. */
  measuredNarrationSeconds: z.number().nullable(),
  /** Sections of the story draft the episode came from, if any. */
  sections: z.array(
    z.object({
      title: z.string(),
      sceneIds: z.array(IdSchema),
      plannedSeconds: z.number(),
      estimatedSeconds: z.number(),
    }),
  ),
  scenes: z.array(BlueprintSceneSchema),
  methods: z.array(MethodAvailabilitySchema),
  storyDraftId: IdSchema.nullable(),
});
export type Blueprint = z.infer<typeof BlueprintSchema>;

/**
 * blocking  - a technical problem: production cannot go ahead as planned
 * pending   - media still to be produced or imported
 * editorial - for a person to review; never blocks on its own
 */
export const PreflightIssueSchema = z.object({
  id: z.string(),
  level: z.enum(["blocking", "pending", "editorial"]),
  sceneId: IdSchema.nullable(),
  code: z.string(),
  message: z.string(),
});
export type PreflightIssue = z.infer<typeof PreflightIssueSchema>;

export const PreflightReportSchema = z.object({
  checkedAt: Timestamp,
  /** Every scene has a plan an available engine (or an import) can carry out. */
  readyToProduce: z.boolean(),
  /** Every scene also has its media, so the episode can be rendered. */
  readyToRender: z.boolean(),
  issues: z.array(PreflightIssueSchema),
});
export type PreflightReport = z.infer<typeof PreflightReportSchema>;

// ------------------------------------------------- hand-off to 5B.2 (media)

/** What Phase 5B.2 will hand to an engine to make one scene's media. */
export interface MediaProductionRequest {
  sceneId: string;
  method: ProductionMethod;
  engineId: string | null;
  model: string | null;
  /** The picture to make. */
  prompt: string;
  /** How it should move. */
  motion: string;
  cameraMotion: string;
  durationSeconds: number;
  requiredAssets: string[];
}

export function mediaProductionRequest(
  scene: Pick<
    BlueprintScene,
    | "sceneId"
    | "visualDescription"
    | "motionPrompt"
    | "cameraMotion"
    | "durationSeconds"
  >,
  plan: Pick<ScenePlan, "method" | "engineId" | "model" | "requiredAssets">,
): MediaProductionRequest {
  return {
    sceneId: scene.sceneId,
    method: plan.method,
    engineId: plan.engineId,
    model: plan.model,
    prompt: scene.visualDescription,
    motion: scene.motionPrompt,
    cameraMotion: scene.cameraMotion,
    durationSeconds: scene.durationSeconds,
    requiredAssets: plan.requiredAssets,
  };
}
