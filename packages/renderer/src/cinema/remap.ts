/**
 * Edit-time remapping: which moment of a simulation each video frame shows.
 * A cut is a list of segments (a teaser, a rewind, the run itself, a
 * replay); between segments the last moment holds. The simulation is never
 * changed, only the order and speed it is shown at, and every segment says
 * how much slower than real time it runs, so the screen can say so too.
 */
import type { Ease } from "@framebop/core";
import { EASE, clamp, lerp } from "../animation/timing";

export interface TimeSegment {
  /** Video frames, `to` excluded. */
  from: number;
  to: number;
  /** Simulated seconds shown at `from` and at `to`. */
  start: number;
  end: number;
  ease?: Ease;
  /** What the segment is, for labels and sound: "run", "replay", ... */
  kind: string;
}

export interface Remapped {
  time: number;
  /** The segment playing now, or null while a moment holds. */
  segment: TimeSegment | null;
}

export function remapTime(
  segments: readonly TimeSegment[],
  frame: number,
): Remapped {
  let held = segments[0]?.start ?? 0;
  for (const segment of segments) {
    if (frame < segment.from) break;
    if (frame < segment.to) {
      const t = (frame - segment.from) / (segment.to - segment.from);
      const k = EASE[segment.ease ?? "linear"](clamp(t));
      return { time: lerp(segment.start, segment.end, k), segment };
    }
    held = segment.end;
  }
  return { time: held, segment: null };
}

/** Seconds of video per simulated second in a linear segment. */
export function slowdown(segment: TimeSegment, fps: number): number {
  return (
    (segment.to - segment.from) / fps / Math.abs(segment.end - segment.start)
  );
}
