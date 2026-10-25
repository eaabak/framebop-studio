/**
 * Layout boxes for checking a picture before it is drawn: where a headline,
 * a chip or an object will sit, computed with the same wrapping and text
 * measurement the overlays use, so the checks see what the viewer will.
 */
import { measure, wrap } from "./measure";

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Placed {
  /** What it is, for findings: "headline:hook", "label.0", "object:sphere". */
  name: string;
  kind: "text" | "object";
  rect: Rect;
  /** Text size in picture pixels, for text. */
  size?: number;
  /** Lines a headline wraps to. */
  lines?: number;
}

export const rect = (
  left: number,
  top: number,
  right: number,
  bottom: number,
): Rect => ({
  left,
  top,
  right,
  bottom,
});

export function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

export function inside(inner: Rect, outer: Rect): boolean {
  return (
    inner.left >= outer.left &&
    inner.right <= outer.right &&
    inner.top >= outer.top &&
    inner.bottom <= outer.bottom
  );
}

/** The box of a KineticTitle: lines as it wraps them, and its underline. */
export function headlineBox(
  text: string,
  size: number,
  x: number,
  y: number,
  maxWidth: number,
): { rect: Rect; lines: number; widest: number } {
  const lines = wrap(text, size, maxWidth);
  const widest = Math.max(...lines.map((line) => measure(line, size)));
  const leading = size * 1.02;
  return {
    rect: rect(
      x - widest / 2,
      y - size * 0.76,
      x + widest / 2,
      y + (lines.length - 1) * leading + size * 0.36 + 9,
    ),
    lines: lines.length,
    widest,
  };
}

/** The box of a Chip, as the Chip component sizes itself. */
export function chipBox(
  text: string,
  size: number,
  x: number,
  y: number,
  filled = false,
): Rect {
  const textWidth = measure(text, size, 800) + text.length * size * 0.06;
  const w = textWidth + size * (filled ? 1.6 : 2.4);
  const h = size * 1.8;
  return rect(x - w / 2, y - h / 2, x + w / 2, y + h / 2);
}

/** The label box of a Callout pinned at (x, y), as the Callout draws it. */
export function calloutBox(
  text: string,
  x: number,
  y: number,
  side: 1 | -1,
  offset?: { x: number; y: number },
): Rect {
  const dx = offset?.x ?? 70 * side;
  const dy = offset?.y ?? -90 * side;
  const cx = x + dx + (dx >= 0 ? 1 : -1) * (measure(text, 30, 800) / 2 + 50);
  return chipBox(text, 30, cx, y + dy);
}
