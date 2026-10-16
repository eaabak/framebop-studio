/**
 * Scene assembly: the shots a scene's picture is made of, and how much of the
 * scene they cover.
 *
 * A scene can be one animation, or a sequence of shots: clips (with a trim)
 * and stills. Nothing is stretched to fill time. A clip's last frame is held
 * only when the user asked for it, and a still lasts as long as it was given
 * (or fills the rest of the scene when it is the one shot meant to). Whatever
 * is left uncovered is a gap, reported in seconds, and a video is not built
 * over a gap.
 */
import { z } from "zod";
import { NARRATION_LEAD_SECONDS, NARRATION_TAIL_SECONDS } from "./render";

export const SceneShotSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("clip"),
    assetId: z.string().min(1).max(80),
    /** Seconds into the clip where playback starts. */
    trimStart: z.number().min(0).max(36_000).default(0),
    /** Seconds into the clip where playback stops. Null: its end. */
    trimEnd: z.number().positive().max(36_000).nullable().default(null),
    /** Seconds its last frame is held after it ends, chosen by the user. */
    holdSeconds: z.number().min(0).max(600).default(0),
  }),
  z.object({
    kind: z.literal("still"),
    assetId: z.string().min(1).max(80),
    /** How long the still is shown. Null: the rest of the scene. */
    seconds: z.number().positive().max(3600).nullable().default(null),
  }),
]);
export type SceneShot = z.infer<typeof SceneShotSchema>;

export const SceneShotsSchema = z.array(SceneShotSchema).max(20);

/** What a stretch of a scene's picture is, as the timeline labels it. */
export const COVERAGE_KINDS = [
  "clip",
  "still",
  "animation",
  /** A clip's last frame, held because the user asked for it. */
  "hold",
  /** An animation's final pose after its timeline ends, as it says. */
  "pose",
] as const;
export type CoverageKind = (typeof COVERAGE_KINDS)[number];

export const CoverageSegmentSchema = z.object({
  kind: z.enum(COVERAGE_KINDS),
  /** Index in the scene's shot list, or null for an animation. */
  shot: z.number().int().nullable(),
  assetId: z.string().nullable(),
  seconds: z.number().nonnegative(),
});
export type CoverageSegment = z.infer<typeof CoverageSegmentSchema>;

export const SceneCoverageSchema = z.object({
  sceneId: z.string(),
  /** How long the scene lasts, lengthened if its narration needs it. */
  requiredSeconds: z.number().nonnegative(),
  narrationSeconds: z.number().nullable(),
  segments: z.array(CoverageSegmentSchema),
  coveredSeconds: z.number().nonnegative(),
  /** Seconds with no picture at all. */
  gapSeconds: z.number().nonnegative(),
  /** Seconds of shots past the scene's end, which are cut. */
  overrunSeconds: z.number().nonnegative(),
  /** A scene of overlay text alone, on black by design. */
  textOnly: z.boolean().default(false),
  /** Shots that cannot be placed, with the reason. */
  problems: z.array(
    z.object({
      shot: z.number().int().nullable(),
      code: z.enum([
        "missing-asset",
        "unknown-duration",
        "bad-trim",
        "two-fill-stills",
      ]),
    }),
  ),
});
export type SceneCoverage = z.infer<typeof SceneCoverageSchema>;

/** A scene lasts its duration, or longer if its narration would be cut. */
export function requiredSceneSeconds(
  durationSeconds: number,
  narrationSeconds: number | null,
): number {
  if (narrationSeconds === null || narrationSeconds <= 0) {
    return durationSeconds;
  }
  return Math.max(
    durationSeconds,
    NARRATION_LEAD_SECONDS + narrationSeconds + NARRATION_TAIL_SECONDS,
  );
}

/**
 * The shots a scene shows: its own list, or for a scene without one, the
 * clip or still in its media slots (a clip wins, as it always has).
 */
export function effectiveShots(
  scene: { imageAssetId: string | null; videoAssetId: string | null },
  shots: readonly SceneShot[],
): SceneShot[] {
  if (shots.length > 0) return [...shots];
  if (scene.videoAssetId) {
    return [
      {
        kind: "clip",
        assetId: scene.videoAssetId,
        trimStart: 0,
        trimEnd: null,
        holdSeconds: 0,
      },
    ];
  }
  if (scene.imageAssetId) {
    return [{ kind: "still", assetId: scene.imageAssetId, seconds: null }];
  }
  return [];
}

export interface CoverageInput {
  sceneId: string;
  durationSeconds: number;
  narrationSeconds: number | null;
  /** An animation drawn for the whole scene, with its timeline's length. */
  animation: { timelineSeconds: number } | null;
  shots: readonly SceneShot[];
  /** Measured length of a clip by asset id; null when it is unknown. */
  clipSeconds(assetId: string): number | null | undefined;
  /** Whether a still's picture is in the library. */
  hasStill(assetId: string): boolean;
}

/** Below this, a difference is rounding, not a gap. */
const EPSILON = 0.02;

export function computeSceneCoverage(input: CoverageInput): SceneCoverage {
  const required = requiredSceneSeconds(
    input.durationSeconds,
    input.narrationSeconds,
  );
  const segments: CoverageSegment[] = [];
  const problems: SceneCoverage["problems"] = [];

  if (input.animation) {
    const animated = Math.min(required, input.animation.timelineSeconds);
    segments.push({
      kind: "animation",
      shot: null,
      assetId: null,
      seconds: animated,
    });
    if (required - animated > EPSILON) {
      segments.push({
        kind: "pose",
        shot: null,
        assetId: null,
        seconds: required - animated,
      });
    }
  } else {
    // Everything with a length of its own first; a still without one fills
    // whatever is left of the scene.
    let fixed = 0;
    let fill: number | null = null;
    const lengths = input.shots.map((shot, index): number => {
      if (shot.kind === "still") {
        if (!input.hasStill(shot.assetId)) {
          problems.push({ shot: index, code: "missing-asset" });
          return 0;
        }
        if (shot.seconds === null) {
          if (fill !== null) {
            problems.push({ shot: index, code: "two-fill-stills" });
            return 0;
          }
          fill = index;
          return 0;
        }
        fixed += shot.seconds;
        return shot.seconds;
      }
      const length = input.clipSeconds(shot.assetId);
      if (length === undefined) {
        problems.push({ shot: index, code: "missing-asset" });
        return 0;
      }
      if (length === null || length <= 0) {
        problems.push({ shot: index, code: "unknown-duration" });
        return 0;
      }
      const end = Math.min(shot.trimEnd ?? length, length);
      if (shot.trimStart >= end) {
        problems.push({ shot: index, code: "bad-trim" });
        return 0;
      }
      fixed += end - shot.trimStart + shot.holdSeconds;
      return end - shot.trimStart;
    });
    input.shots.forEach((shot, index) => {
      const played =
        index === fill ? Math.max(0, required - fixed) : (lengths[index] ?? 0);
      if (played > 0) {
        segments.push({
          kind: shot.kind,
          shot: index,
          assetId: shot.assetId,
          seconds: played,
        });
      }
      if (shot.kind === "clip" && played > 0 && shot.holdSeconds > 0) {
        segments.push({
          kind: "hold",
          shot: index,
          assetId: shot.assetId,
          seconds: shot.holdSeconds,
        });
      }
    });
  }

  const covered = segments.reduce((sum, segment) => sum + segment.seconds, 0);
  const gap = required - covered;
  const overrun = covered - required;
  return {
    sceneId: input.sceneId,
    requiredSeconds: required,
    narrationSeconds: input.narrationSeconds,
    segments,
    coveredSeconds: Math.min(covered, required),
    gapSeconds: gap > EPSILON ? gap : 0,
    overrunSeconds: overrun > EPSILON ? overrun : 0,
    problems,
    textOnly: false,
  };
}
