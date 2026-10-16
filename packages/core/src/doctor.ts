/**
 * Scene Doctor: technical inspection of a finished video.
 *
 * Every finding is a measurement with a time range and the values behind it.
 * Nothing here judges artistic quality. When the video was built by Framebop
 * and its timeline is known, a finding that matches what was planned (a
 * still shot, a chosen hold, a text card on black, a scene without sound) is
 * marked as intended rather than as a defect. For any other video, what may
 * be deliberate is reported as something to review, never as certain.
 */
import { z } from "zod";

const Timestamp = z.string();

/** What each detector looks for, and how sensitive it is. */
export const DoctorThresholdsSchema = z.object({
  black: z
    .object({
      /** Shortest dark stretch reported, in seconds. */
      minSeconds: z.number().positive().default(0.5),
      /** Brightness (0..1) below which a pixel counts as black. */
      pixelThreshold: z.number().min(0).max(1).default(0.1),
      /** Share of a picture that must be black. */
      pictureRatio: z.number().min(0).max(1).default(0.98),
    })
    .default({ minSeconds: 0.5, pixelThreshold: 0.1, pictureRatio: 0.98 }),
  freeze: z
    .object({
      minSeconds: z.number().positive().default(2),
      /** Change between frames below this (dB) counts as no change. */
      noiseDb: z.number().max(0).default(-60),
    })
    .default({ minSeconds: 2, noiseDb: -60 }),
  silence: z
    .object({
      minSeconds: z.number().positive().default(2),
      /** Level below which sound counts as silence. */
      noiseDb: z.number().max(0).default(-50),
    })
    .default({ minSeconds: 2, noiseDb: -50 }),
  /**
   * Peaks at or above this level (dBFS) are reported as likely clipping.
   * Lossy audio rarely reaches 0 dBFS even when its source was clipped (a
   * clipped tone through AAC peaks near -0.4 dBFS), hence the margin.
   */
  clippingDbfs: z.number().max(0).default(-0.5),
  /** Seconds two durations may differ before it is reported. */
  durationToleranceSeconds: z.number().positive().default(0.25),
});
export type DoctorThresholds = z.infer<typeof DoctorThresholdsSchema>;

export const ISSUE_TYPES = [
  "unreadable",
  "decode_error",
  "missing_frames",
  "black",
  "frozen",
  "missing_audio",
  "silence",
  "clipping",
  "duration_mismatch",
  "stream_mismatch",
  "timeline_gap",
] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];

export const ISSUE_SEVERITIES = [
  "critical",
  "warning",
  "review",
  "info",
] as const;
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];

/**
 * Why a finding has the severity it has, for the interface to explain:
 *  - "defect": nothing planned explains it
 *  - "possible": no timeline to compare with; it may be deliberate
 *  - "intended": the timeline planned exactly this
 */
export const ISSUE_INTENTS = ["defect", "possible", "intended"] as const;

export const InspectionIssueSchema = z.object({
  /** Stable: the same finding in the same video always has the same id. */
  id: z.string(),
  type: z.enum(ISSUE_TYPES),
  severity: z.enum(ISSUE_SEVERITIES),
  intent: z.enum(ISSUE_INTENTS),
  /** Seconds into the video; null for findings about the whole file. */
  start: z.number().nonnegative().nullable(),
  end: z.number().nonnegative().nullable(),
  /** True when the time is known only roughly (decode errors). */
  approximateTime: z.boolean().default(false),
  /** What was measured, by name: levels in dB, durations in seconds. */
  measured: z.record(z.string(), z.union([z.number(), z.string()])),
  /**
   * What planned element explains or contradicts it, for the interface to
   * name: "still", "hold", "text", "animation", "narration", "music", "clip".
   */
  context: z.string().nullable().default(null),
  /** Pictures taken from the video itself, relative to the media root. */
  frames: z.array(z.object({ at: z.number(), file: z.string() })),
  /** Lines FFmpeg printed, as they were, for decode errors. */
  log: z.array(z.string()).default([]),
  sceneId: z.string().nullable(),
  sceneIndex: z.number().int().nullable(),
  shotIndex: z.number().int().nullable(),
});
export type InspectionIssue = z.infer<typeof InspectionIssueSchema>;

export const InspectionSourceSchema = z.object({
  kind: z.enum(["export", "file"]),
  /** Absolute path of the video. Never written to. */
  path: z.string(),
  renderId: z.string().nullable(),
  projectId: z.string().nullable(),
  episodeId: z.string().nullable(),
  /** Size and modification time when the inspection started. */
  sizeBytes: z.number().int().nonnegative(),
  modifiedAt: z.string(),
});
export type InspectionSource = z.infer<typeof InspectionSourceSchema>;

export const InspectionOverviewSchema = z.object({
  durationSeconds: z.number().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  fps: z.number().nullable(),
  videoCodec: z.string().nullable(),
  audioCodec: z.string().nullable(),
  audioDurationSeconds: z.number().nullable(),
  framesDecoded: z.number().int().nullable(),
  /** Whether the Framebop timeline was there to compare with. */
  timeline: z.boolean(),
});
export type InspectionOverview = z.infer<typeof InspectionOverviewSchema>;

/** Scenes of a Framebop export, where they lie in the video. */
export const InspectionSceneSchema = z.object({
  sceneId: z.string(),
  index: z.number().int(),
  title: z.string(),
  start: z.number(),
  end: z.number(),
});

export const InspectionIssuesSchema = z.array(InspectionIssueSchema);
export const InspectionScenesSchema = z.array(InspectionSceneSchema);

export const InspectionSchema = z.object({
  id: z.string(),
  jobId: z.string().nullable(),
  name: z.string(),
  source: InspectionSourceSchema,
  thresholds: DoctorThresholdsSchema,
  status: z.enum([
    "pending",
    "running",
    "completed",
    "failed",
    "cancelled",
    "interrupted",
  ]),
  error: z.string().nullable(),
  overview: InspectionOverviewSchema.nullable(),
  scenes: z.array(InspectionSceneSchema),
  issues: z.array(InspectionIssueSchema),
  createdAt: Timestamp,
  finishedAt: Timestamp.nullable(),
});
export type Inspection = z.infer<typeof InspectionSchema>;

export const InspectRequestSchema = z.strictObject({
  source: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("export"), renderId: z.string().min(1) }),
    z.strictObject({
      kind: z.literal("file"),
      path: z.string().min(1).max(4096),
    }),
  ]),
  thresholds: DoctorThresholdsSchema.optional(),
});

/** A Framebop export that can be inspected, with where it came from. */
export const DoctorExportSchema = z.object({
  renderId: z.string(),
  path: z.string(),
  episodeId: z.string(),
  episodeTitle: z.string(),
  projectName: z.string(),
  durationSeconds: z.number(),
  createdAt: Timestamp,
});
export type DoctorExport = z.infer<typeof DoctorExportSchema>;
