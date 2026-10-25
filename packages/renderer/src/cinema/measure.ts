/**
 * Text measurement for layout: the real font through a canvas where there
 * is one (the picture), the font's measured widths where there is not (the
 * engine's checks). No JSX here, so the engine can use it.
 */
import { interWidth } from "./metrics";
import { FONT } from "./palette";

/** The bit of a 2D canvas context measuring needs, without DOM types. */
interface Measurer {
  font: string;
  measureText(text: string): { width: number };
}

/** The bit of `document.fonts` measuring needs. */
interface FontSet {
  check(font: string): boolean;
}

let context: Measurer | null | undefined;
const widths = new Map<string, number>();

function canvas(): Measurer | null {
  const doc = (
    globalThis as {
      document?: {
        createElement(tag: "canvas"): {
          getContext(kind: "2d"): Measurer | null;
        };
      };
    }
  ).document;
  return doc ? doc.createElement("canvas").getContext("2d") : null;
}

/**
 * Whether the canvas would measure the Lab font itself. Before the font has
 * loaded it measures a fallback, whose wider letters must never be kept:
 * render tabs that measured early would space every title they draw
 * differently, and the title would flicker between frames.
 */
function fontLoaded(font: string): boolean {
  const fonts = (globalThis as { document?: { fonts?: FontSet } }).document
    ?.fonts;
  return fonts ? fonts.check(font) : true;
}

/** Width of `text` in pixels at `size` and `weight` in the Lab font. */
export function measure(text: string, size: number, weight = 850): number {
  const key = `${weight}|${size}|${text}`;
  const known = widths.get(key);
  if (known !== undefined) return known;
  context ??= canvas();
  // Without a canvas (in the engine), or before the font has loaded, the
  // font's measured widths; only the real font's widths are kept.
  const font = `${weight} ${size}px ${FONT}`;
  if (!context || !fontLoaded(font)) return interWidth(text, size, weight);
  context.font = font;
  const width = context.measureText(text).width;
  widths.set(key, width);
  return width;
}

/**
 * Width with letter spacing: `tracking` in ems between letters, as SVG's
 * letter-spacing adds it.
 */
export function measureTracked(
  text: string,
  size: number,
  weight = 850,
  tracking = 0,
): number {
  return (
    measure(text, size, weight) +
    tracking * size * Math.max(0, [...text].length - 1)
  );
}

/** Splits text into balanced lines no wider than `max`. */
export function wrap(
  text: string,
  size: number,
  max: number,
  weight = 850,
  tracking = 0,
) {
  const measure = (line: string, s: number, w: number) =>
    measureTracked(line, s, w, tracking);
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next, size, weight) > max) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  if (lines.length !== 2) return lines;
  // Two lines: choose the split that makes them most even.
  let best = lines;
  let score = Infinity;
  for (let i = 1; i < words.length; i += 1) {
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    const wa = measure(a, size, weight);
    const wb = measure(b, size, weight);
    if (wa <= max && wb <= max && Math.abs(wa - wb) < score) {
      best = [a, b];
      score = Math.abs(wa - wb);
    }
  }
  return best;
}
