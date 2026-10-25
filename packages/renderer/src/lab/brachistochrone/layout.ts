/**
 * Where the race's overlay puts things, shared by the overlay and by the
 * layout preflight, so the checks measure the picture that is drawn.
 */
import { headlineBox } from "../../cinema/layout";
import { measure } from "../../cinema/measure";
import { SAFE } from "../../cinema/palette";

export const RACE_TYPE = {
  titleY: SAFE.top + 150,
  maxWidth: SAFE.right - SAFE.left - 40,
  hook: 118,
  reveal: 112,
  why: 104,
  closing: 112,
} as const;

/** Where each lane's name and shape labels are pinned along it (0..1). */
export const RACE_PINS = {
  name: [0.42, 0.62] as const,
  shape: [0.16, 0.1] as const,
  /** The curve's shape label sits between the lanes, down and right. */
  shapeOffset: { x: 90, y: 70 },
};

/** The two score cards under the race. */
export function raceCards(width: number) {
  const w = 420;
  const h = 150;
  const y = SAFE.bottom - 70;
  return [0.27, 0.73].map((share) => {
    const x = width * share;
    return {
      x,
      y,
      w,
      h,
      rect: {
        left: x - w / 2,
        top: y - h / 2,
        right: x + w / 2,
        bottom: y + h / 2,
      },
    };
  });
}

/**
 * Where a chip under a headline goes: below the headline's measured last
 * line, however many lines it wraps to, never at a fixed height.
 */
export function underHeadline(
  text: string,
  size: number,
  y: number,
  width: number,
  gap = 44,
): number {
  return (
    headlineBox(text, size, width / 2, y, RACE_TYPE.maxWidth).rect.bottom + gap
  );
}

/**
 * The size a contender's name takes on its card: 30 px, or smaller so it
 * fits beside the place badge (the room between the dot and the badge).
 */
export function cardLabelSize(label: string, cardWidth = 420): number {
  const room = cardWidth - 64 - 132;
  const width = measure(label, 30, 800) + label.length * 30 * 0.1;
  return width <= room ? 30 : Math.floor((30 * room) / width);
}

/** Which headline shows at a frame, and where, for things that avoid it. */
export function headlineAt(
  f: number,
  lab: {
    releaseFrame: number;
    beats: { reveal: number; explanation: number; closing: number };
    text: { hook: string; explanation: string; closing: string };
  },
  result: string,
  duration: number,
): { text: string; size: number; y: number } | null {
  const { beats, releaseFrame: go, text } = lab;
  const y = RACE_TYPE.titleY;
  if (f >= 1 && f <= go + 30)
    return { text: text.hook, size: RACE_TYPE.hook, y };
  if (f >= beats.reveal && f <= beats.explanation)
    return { text: result, size: RACE_TYPE.reveal, y: y + 10 };
  if (f >= beats.explanation + 4 && f <= beats.closing + 2)
    return { text: text.explanation, size: RACE_TYPE.why, y };
  if (f >= beats.closing + 4 && f <= duration - 6)
    return { text: text.closing, size: RACE_TYPE.closing, y };
  return null;
}
