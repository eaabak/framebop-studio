/**
 * Scene Doctor's measurements and how they are judged.
 *
 * One FFmpeg pass decodes the whole video and runs the detectors side by
 * side: `blackdetect` (dark pictures), `freezedetect` (pictures that do not
 * change), `silencedetect` (quiet sound) and `astats` (peak level per tenth
 * of a second). Its log is read line by line as it is written, so memory does
 * not grow with the length of the video. Decoder complaints in the same log
 * are decode errors; their time is the last time the log mentioned, which is
 * close but not exact.
 *
 * Judging compares each measurement with the Framebop timeline when there is
 * one: a frozen picture during a still shot, a chosen hold or a final pose,
 * black during a text card, or silence where nothing was meant to sound, is
 * intended. Without a timeline the same findings are possible issues for a
 * person to review. No score is invented anywhere.
 */
import { createHash } from "node:crypto";
import {
  type DoctorThresholds,
  type InspectionIssue,
  type IssueSeverity,
  type RenderPlan,
} from "@framebop/core";

export interface Interval {
  start: number;
  end: number;
}

/** Most decode errors and clipping stretches kept; the rest are counted. */
const KEEP = 200;

/** Reads the analysis pass's log and progress as they arrive. */
export class AnalysisLog {
  readonly black: Interval[] = [];
  readonly frozen: Interval[] = [];
  readonly silence: Interval[] = [];
  readonly clipping: (Interval & { peakDb: number })[] = [];
  readonly decodeErrors: { at: number | null; line: string }[] = [];
  decodeErrorCount = 0;
  maxPeakDb: number | null = null;
  framesDecoded: number | null = null;
  /** The latest media time seen anywhere in the output. */
  time = 0;

  private freezeStart: number | null = null;
  private silenceStart: number | null = null;
  private windowAt = 0;

  constructor(private readonly clippingDbfs: number) {}

  /** `-progress` output: key=value lines. */
  progress(line: string): void {
    const [key, value] = line.split("=", 2);
    if (key === "frame") this.framesDecoded = Number(value) || 0;
    if (key === "out_time_us" || key === "out_time_ms") {
      const seconds = Number(value) / 1_000_000;
      if (Number.isFinite(seconds) && seconds >= 0) this.time = seconds;
    }
  }

  log(line: string): void {
    let match: RegExpExecArray | null;
    if (
      (match = /black_start:\s*([\d.]+)\s+black_end:\s*([\d.]+)/.exec(line))
    ) {
      this.black.push({ start: Number(match[1]), end: Number(match[2]) });
      return;
    }
    if ((match = /freeze_start:\s*([\d.]+)/.exec(line))) {
      this.freezeStart = Number(match[1]);
      return;
    }
    if ((match = /freeze_end:\s*([\d.]+)/.exec(line))) {
      if (this.freezeStart !== null) {
        this.frozen.push({ start: this.freezeStart, end: Number(match[1]) });
      }
      this.freezeStart = null;
      return;
    }
    if ((match = /silence_start:\s*(-?[\d.]+)/.exec(line))) {
      this.silenceStart = Math.max(0, Number(match[1]));
      return;
    }
    if ((match = /silence_end:\s*([\d.]+)/.exec(line))) {
      if (this.silenceStart !== null) {
        this.silence.push({ start: this.silenceStart, end: Number(match[1]) });
      }
      this.silenceStart = null;
      return;
    }
    if ((match = /pts_time:\s*([\d.]+)/.exec(line))) {
      this.windowAt = Number(match[1]);
      this.time = Math.max(this.time, this.windowAt);
      return;
    }
    if ((match = /Peak_level=(-?[\d.]+|-inf)/.exec(line))) {
      const db = match[1] === "-inf" ? -Infinity : Number(match[1]);
      if (!Number.isFinite(db)) return;
      if (this.maxPeakDb === null || db > this.maxPeakDb) this.maxPeakDb = db;
      if (db >= this.clippingDbfs) this.clipped(this.windowAt, db);
      return;
    }
    if (isDecoderComplaint(line)) {
      this.decodeErrorCount += 1;
      if (this.decodeErrors.length < KEEP) {
        this.decodeErrors.push({ at: this.time, line: line.trim() });
      }
    }
  }

  /** Closes what was still open when the video ended. */
  finish(durationSeconds: number): void {
    if (this.freezeStart !== null && durationSeconds > this.freezeStart) {
      this.frozen.push({ start: this.freezeStart, end: durationSeconds });
    }
    if (this.silenceStart !== null && durationSeconds > this.silenceStart) {
      this.silence.push({ start: this.silenceStart, end: durationSeconds });
    }
    this.freezeStart = null;
    this.silenceStart = null;
  }

  /** Neighbouring loud windows (0.1 s each) join into one stretch. */
  private clipped(at: number, db: number): void {
    const last = this.clipping[this.clipping.length - 1];
    if (last && at - last.end <= 0.11) {
      last.end = at + 0.1;
      last.peakDb = Math.max(last.peakDb, db);
    } else if (this.clipping.length < KEEP) {
      this.clipping.push({ start: at, end: at + 0.1, peakDb: db });
    }
  }
}

/** A decoder (not one of our filters) saying the stream is damaged. */
export function isDecoderComplaint(line: string): boolean {
  if (/^\[(Parsed_|blackdetect|freezedetect|silencedetect)/.test(line)) {
    return false;
  }
  return /error while decoding|invalid nal|concealing|corrupt|non-existing pps|missing reference|decode_slice_header error|Invalid data found|Error while decoding/i.test(
    line,
  );
}

// ------------------------------------------------------------------ timeline

export type PlannedContext =
  "still" | "hold" | "pose" | "text" | "clip" | "image-motion" | "animation";

export interface Timeline {
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  scenes: { sceneId: string; index: number; start: number; end: number }[];
  shots: {
    sceneId: string;
    sceneIndex: number;
    shotIndex: number;
    start: number;
    end: number;
    context: PlannedContext;
  }[];
  /** Where the picture is meant not to change. */
  still: (Interval & { context: PlannedContext })[];
  /** Where black is the design: text cards. */
  dark: Interval[];
  narration: Interval[];
  music: boolean;
  /** Problems in the plan itself: gaps or overlaps between shots. */
  gaps: { sceneId: string; sceneIndex: number; start: number; end: number }[];
}

/** What a Framebop render plan says the video contains, in seconds. */
export function timelineFromPlan(plan: RenderPlan): Timeline {
  const seconds = (frames: number) => frames / plan.fps;
  const timeline: Timeline = {
    durationSeconds: seconds(plan.durationInFrames),
    width: plan.width,
    height: plan.height,
    fps: plan.fps,
    scenes: [],
    shots: [],
    still: [],
    dark: [],
    narration: plan.audio
      .filter((clip) => clip.kind === "narration")
      .map((clip) => ({
        start: seconds(clip.from),
        end: seconds(clip.from + clip.durationInFrames),
      })),
    // A scene's sound effects run throughout, like music.
    music: plan.audio.some(
      (clip) => clip.kind === "music" || clip.kind === "effects",
    ),
    gaps: [],
  };
  for (const scene of plan.scenes) {
    const start = seconds(scene.from);
    const end = seconds(scene.from + scene.durationInFrames);
    timeline.scenes.push({
      sceneId: scene.sceneId,
      index: scene.index,
      start,
      end,
    });
    if (scene.shots.length === 0) {
      timeline.still.push({ start, end, context: "text" });
      timeline.dark.push({ start, end });
      continue;
    }
    let covered = 0;
    scene.shots.forEach((shot, shotIndex) => {
      const from = start + seconds(shot.from);
      const to = from + seconds(shot.durationInFrames);
      covered += shot.durationInFrames;
      const { visual } = shot;
      const context: PlannedContext =
        visual.kind === "image"
          ? visual.motion === "static"
            ? "still"
            : "image-motion"
          : visual.kind === "video"
            ? "clip"
            : "animation";
      timeline.shots.push({
        sceneId: scene.sceneId,
        sceneIndex: scene.index,
        shotIndex,
        start: from,
        end: to,
        context,
      });
      if (context === "still")
        timeline.still.push({ start: from, end: to, context });
      if (
        visual.kind === "video" &&
        shot.durationInFrames > visual.playFrames
      ) {
        timeline.still.push({
          start: from + seconds(visual.playFrames),
          end: to,
          context: "hold",
        });
      }
      if (visual.kind === "animation") {
        const animated = visual.spec.durationFrames / visual.spec.fps;
        if (from + animated < to) {
          timeline.still.push({
            start: from + animated,
            end: to,
            context: "pose",
          });
        }
      }
    });
    if (covered !== scene.durationInFrames) {
      timeline.gaps.push({
        sceneId: scene.sceneId,
        sceneIndex: scene.index,
        start: start + seconds(Math.min(covered, scene.durationInFrames)),
        end: start + seconds(Math.max(covered, scene.durationInFrames)),
      });
    }
  }
  return timeline;
}

// ------------------------------------------------------------------- judging

export interface Probe {
  durationSeconds: number | null;
  videoDurationSeconds: number | null;
  audioDurationSeconds: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  /** The nominal rate, which differs from `fps` for variable rates. */
  nominalFps: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
}

const PLAYABLE = new Set([
  "h264",
  "hevc",
  "prores",
  "vp8",
  "vp9",
  "av1",
  "mpeg4",
]);

const overlap = (a: Interval, b: Interval) =>
  Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));

/** The planned interval that covers most of `interval`, with how much. */
function bestMatch<T extends Interval>(
  interval: Interval,
  candidates: readonly T[],
): { item: T | null; share: number } {
  const length = Math.max(interval.end - interval.start, 1e-6);
  let best: T | null = null;
  let covered = 0;
  let total = 0;
  for (const candidate of candidates) {
    const shared = overlap(interval, candidate);
    total += shared;
    if (shared > covered) {
      covered = shared;
      best = candidate;
    }
  }
  return { item: best, share: Math.min(1, total / length) };
}

function issueId(
  type: string,
  start: number | null,
  end: number | null,
  field: string,
): string {
  return createHash("sha256")
    .update(
      `${type}:${start?.toFixed(2) ?? "-"}:${end?.toFixed(2) ?? "-"}:${field}`,
    )
    .digest("hex")
    .slice(0, 16);
}

const round = (value: number) => Math.round(value * 1000) / 1000;

export function judge(input: {
  probe: Probe;
  log: AnalysisLog;
  timeline: Timeline | null;
  thresholds: DoctorThresholds;
}): InspectionIssue[] {
  const { probe, log, timeline, thresholds } = input;
  const issues: InspectionIssue[] = [];
  const add = (
    type: InspectionIssue["type"],
    severity: IssueSeverity,
    intent: InspectionIssue["intent"],
    range: Interval | null,
    measured: InspectionIssue["measured"],
    extra: Partial<InspectionIssue> = {},
  ) => {
    const start = range ? round(range.start) : null;
    const end = range ? round(range.end) : null;
    // The scene and shot the finding falls in, by the most overlap.
    const scene =
      range && timeline ? bestMatch(range, timeline.scenes).item : null;
    const shot =
      range && timeline ? bestMatch(range, timeline.shots).item : null;
    issues.push({
      id: issueId(type, start, end, String(measured.field ?? "")),
      type,
      severity,
      intent,
      start,
      end,
      approximateTime: false,
      measured,
      context: null,
      frames: [],
      log: [],
      sceneId: scene?.sceneId ?? null,
      sceneIndex: scene?.index ?? null,
      shotIndex:
        shot && scene && shot.sceneId === scene.sceneId ? shot.shotIndex : null,
      ...extra,
    });
  };
  const seconds = (interval: Interval) => round(interval.end - interval.start);

  // ------------------------------------------------------------ the stream
  if (log.decodeErrorCount > 0) {
    const times = log.decodeErrors
      .map((error) => error.at)
      .filter((at): at is number => at !== null);
    add(
      "decode_error",
      "critical",
      "defect",
      times.length > 0
        ? { start: Math.min(...times), end: Math.max(...times) }
        : null,
      { errors: log.decodeErrorCount },
      {
        approximateTime: true,
        log: log.decodeErrors.slice(0, 10).map((error) => error.line),
      },
    );
  }
  const videoSeconds = probe.videoDurationSeconds ?? probe.durationSeconds;
  if (log.framesDecoded !== null && videoSeconds && probe.fps) {
    const expected = Math.round(videoSeconds * probe.fps);
    if (log.framesDecoded < expected - Math.max(2, expected * 0.01)) {
      add("missing_frames", "warning", "defect", null, {
        expectedFrames: expected,
        decodedFrames: log.framesDecoded,
      });
    }
  }
  if (probe.videoCodec && !PLAYABLE.has(probe.videoCodec)) {
    add("stream_mismatch", "warning", "defect", null, {
      field: "codec",
      found: probe.videoCodec,
    });
  }
  if (
    probe.fps !== null &&
    probe.nominalFps !== null &&
    Math.abs(probe.fps - probe.nominalFps) > 0.5
  ) {
    add("stream_mismatch", "review", "possible", null, {
      field: "variable_frame_rate",
      averageFps: round(probe.fps),
      nominalFps: round(probe.nominalFps),
    });
  }
  if (timeline) {
    for (const [field, found, expected] of [
      ["width", probe.width, timeline.width],
      ["height", probe.height, timeline.height],
      ["fps", probe.fps === null ? null : round(probe.fps), timeline.fps],
    ] as const) {
      if (found !== null && Math.abs(found - expected) > 0.01) {
        add("stream_mismatch", "warning", "defect", null, {
          field,
          found,
          expected,
        });
      }
    }
    if (
      probe.durationSeconds !== null &&
      Math.abs(probe.durationSeconds - timeline.durationSeconds) >
        thresholds.durationToleranceSeconds
    ) {
      add("duration_mismatch", "warning", "defect", null, {
        field: "timeline",
        found: round(probe.durationSeconds),
        expected: round(timeline.durationSeconds),
      });
    }
    for (const gap of timeline.gaps) {
      add("timeline_gap", "warning", "defect", gap, { seconds: seconds(gap) });
    }
  }
  if (
    probe.audioDurationSeconds !== null &&
    videoSeconds !== null &&
    Math.abs(probe.audioDurationSeconds - videoSeconds) >
      thresholds.durationToleranceSeconds
  ) {
    add("duration_mismatch", "warning", "defect", null, {
      field: "audio",
      found: round(probe.audioDurationSeconds),
      expected: round(videoSeconds),
    });
  }

  // --------------------------------------------------------------- sound
  const expectsSound = timeline
    ? timeline.music || timeline.narration.length > 0
    : null;
  if (probe.audioCodec === null) {
    if (expectsSound === true) {
      add("missing_audio", "critical", "defect", null, {});
    } else if (expectsSound === null) {
      add("missing_audio", "review", "possible", null, {});
    }
  }
  for (const interval of log.silence) {
    const measured = {
      seconds: seconds(interval),
      thresholdDb: thresholds.silence.noiseDb,
    };
    if (!timeline) {
      add("silence", "review", "possible", interval, measured);
      continue;
    }
    const speech = bestMatch(interval, timeline.narration);
    if (speech.share * (interval.end - interval.start) > 0.5) {
      add("silence", "warning", "defect", interval, measured, {
        context: "narration",
      });
    } else if (timeline.music) {
      add("silence", "warning", "defect", interval, measured, {
        context: "music",
      });
    } else {
      add("silence", "info", "intended", interval, measured);
    }
  }
  for (const interval of log.clipping) {
    add("clipping", "warning", "defect", interval, {
      peakDb: round(interval.peakDb),
      thresholdDb: thresholds.clippingDbfs,
    });
  }

  // ------------------------------------------------------------- picture
  for (const interval of log.black) {
    const measured = { seconds: seconds(interval) };
    if (!timeline) {
      add("black", "review", "possible", interval, measured);
    } else if (bestMatch(interval, timeline.dark).share >= 0.8) {
      add("black", "info", "intended", interval, measured, { context: "text" });
    } else {
      add("black", "warning", "defect", interval, measured);
    }
  }
  for (const interval of log.frozen) {
    const measured = { seconds: seconds(interval) };
    if (!timeline) {
      add("frozen", "review", "possible", interval, measured);
      continue;
    }
    const planned = bestMatch(interval, timeline.still);
    if (planned.share >= 0.8) {
      add("frozen", "info", "intended", interval, measured, {
        context: planned.item?.context ?? null,
      });
    } else {
      const shot = bestMatch(interval, timeline.shots).item;
      add("frozen", "warning", "defect", interval, measured, {
        context: shot?.context ?? null,
      });
    }
  }

  const order: Record<IssueSeverity, number> = {
    critical: 0,
    warning: 1,
    review: 2,
    info: 3,
  };
  return issues.sort(
    (a, b) =>
      order[a.severity] - order[b.severity] ||
      (a.start ?? -1) - (b.start ?? -1),
  );
}
