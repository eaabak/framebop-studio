/**
 * Easing, keyframe tracks and noise. All of it is a pure function of time,
 * so a frame looks the same however, and in whatever order, it is rendered.
 */
import type { Ease, Track } from "@framebop/core";

const { PI, sin, cos, min, max, floor } = Math;

export const clamp = (value: number, low = 0, high = 1) =>
  min(high, max(low, value));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 0 to 1 and back in between, with zero slope at both ends. */
export const smoothstep = (t: number) => {
  const x = clamp(t);
  return x * x * (3 - 2 * x);
};

export const EASE: Record<Ease, (t: number) => number> = {
  linear: (t) => t,
  inSine: (t) => 1 - cos((t * PI) / 2),
  outSine: (t) => sin((t * PI) / 2),
  inOutSine: (t) => -(cos(PI * t) - 1) / 2,
  inCubic: (t) => t * t * t,
  outCubic: (t) => 1 - (1 - t) ** 3,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  outBack: (t) => {
    const c = 1.70158;
    return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
  },
};

/** The value of a track at a time; it holds its first and last keys. */
export function sample(track: Track, time: number): number {
  if (typeof track === "number") return track;
  const first = track[0]!;
  if (time <= first.frame) return first.value;
  for (let i = 1; i < track.length; i += 1) {
    const to = track[i]!;
    if (time < to.frame) {
      const from = track[i - 1]!;
      const span = to.frame - from.frame;
      const t = span > 0 ? (time - from.frame) / span : 1;
      return lerp(from.value, to.value, EASE[from.ease](t));
    }
  }
  return track[track.length - 1]!.value;
}

/**
 * How much a clip is in effect: rises over `blend` frames after it starts
 * and falls over `blend` frames before it ends.
 */
export function weight(time: number, from: number, to: number, blend: number) {
  if (time <= from || time >= to) return 0;
  if (blend <= 0) return 1;
  const edge = min(blend, (to - from) / 2);
  return smoothstep(min(time - from, to - time) / edge);
}

/** A repeatable pseudo-random number in [0, 1) for an integer and a seed. */
export function hash(n: number, seed = 0): number {
  let x = (floor(n) * 374761393 + seed * 668265263) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** Smooth noise in [-1, 1]: random values at whole numbers, eased between. */
export function noise(t: number, seed = 0): number {
  const i = floor(t);
  const f = t - i;
  const a = hash(i, seed) * 2 - 1;
  const b = hash(i + 1, seed) * 2 - 1;
  return lerp(a, b, smoothstep(f));
}
