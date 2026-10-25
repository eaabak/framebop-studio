/**
 * The Müller-Lyer figures in picture pixels. Both shafts come from the one
 * `shaft` length, so they are equal by construction; only the fins differ:
 * outward fins (the figure that looks longer) or inward fins (shorter).
 */
import type { MullerLyerLab } from "@framebop/core";

export interface Point {
  x: number;
  y: number;
}

export interface Figure {
  /** The shaft, left end to right end. */
  from: Point;
  to: Point;
  /** Four fins, each from a shaft end to its tip. */
  fins: [Point, Point][];
  /** Fins pointing away from the shaft: the figure looks longer. */
  outward: boolean;
  /** Left and right of the whole figure, fins included. */
  extent: { left: number; right: number };
}

/** The largest half-width a figure may take, as a share of the picture. */
export const MAX_HALF_WIDTH = 0.44;

/** The longest shaft that keeps both figures, fins and all, in the picture. */
export function maxShaft(fin: number, finAngle: number): number {
  return MAX_HALF_WIDTH / (0.5 + fin * Math.cos((finAngle * Math.PI) / 180));
}

export function mullerFigures(
  lab: Pick<
    MullerLyerLab,
    "shaft" | "fin" | "finAngle" | "gap" | "longerOnTop"
  >,
  width: number,
  height: number,
  /** Degrees added to the fins' angle, for their gentle breathing. */
  flex = 0,
): { top: Figure; bottom: Figure; length: number } {
  const length = Math.min(lab.shaft, maxShaft(lab.fin, lab.finAngle)) * width;
  const fin = lab.fin * length;
  const angle = ((lab.finAngle + flex) * Math.PI) / 180;
  const cx = width / 2;
  const cy = height * 0.58;
  const half = (lab.gap * height) / 2;
  const make = (y: number, outward: boolean): Figure => {
    const from = { x: cx - length / 2, y };
    const to = { x: cx + length / 2, y };
    // Outward fins point away from the shaft's middle, inward ones towards it.
    const dx = Math.cos(angle) * fin * (outward ? 1 : -1);
    const dy = Math.sin(angle) * fin;
    const fins: [Point, Point][] = [
      [from, { x: from.x - dx, y: y - dy }],
      [from, { x: from.x - dx, y: y + dy }],
      [to, { x: to.x + dx, y: y - dy }],
      [to, { x: to.x + dx, y: y + dy }],
    ];
    const reach = Math.max(0, dx);
    return {
      from,
      to,
      fins,
      outward,
      extent: { left: from.x - reach, right: to.x + reach },
    };
  };
  return {
    top: make(cy - half, lab.longerOnTop),
    bottom: make(cy + half, !lab.longerOnTop),
    length,
  };
}

/**
 * Where each figure's label sits: beyond its fins (above the top figure,
 * below the bottom one), so a label never lies on a fin.
 */
export function labelYs(top: Figure, bottom: Figure): [number, number] {
  const above = Math.min(top.from.y, ...top.fins.map(([, tip]) => tip.y));
  const below = Math.max(bottom.from.y, ...bottom.fins.map(([, tip]) => tip.y));
  return [above - 52, below + 52];
}

/** The Müller-Lyer overlay: headline sizes and where the chips go. */
export const ILLUSION_TYPE = {
  hook: 112,
  prediction: 108,
  same: 118,
  why: 96,
  closing: 108,
  label: 34,
  chip: 30,
  mascot: 150,
} as const;
