/**
 * Kinetic typography for vertical video, drawn as SVG over the picture:
 * headlines whose letters spring up one after another and lift away, a
 * punch for big results, and small labels. Text is measured with the real
 * font, so letters sit where the font puts them.
 */
import type { ReactNode } from "react";
import { EASE, clamp, lerp } from "../animation/timing";
import { measure, wrap } from "./measure";
import { COLORS, FONT, mix } from "./palette";

/** 0..1 from `from` to `to`, eased. */
export function ramp(
  frame: number,
  from: number,
  to: number,
  ease: (t: number) => number = EASE.inOutCubic,
) {
  return ease(clamp((frame - from) / (to - from)));
}

/** Rises over `fade` frames from `from`, falls over `fade` frames to `to`. */
export function during(frame: number, from: number, to: number, fade = 10) {
  return Math.min(
    ramp(frame, from, from + fade),
    1 - ramp(frame, to - fade, to),
  );
}

/**
 * A headline: letters spring up in turn, words naming an accent take its
 * colour, and the whole lifts away at the end. `punch` adds a hit of scale
 * as it lands, for results.
 */
export function KineticTitle({
  text,
  frame,
  from,
  to,
  x,
  y,
  size,
  maxWidth,
  accents = {},
  punch = 0,
}: {
  text: string;
  frame: number;
  from: number;
  to: number;
  /** Centre of the block. */
  x: number;
  /** Baseline of the first line. */
  y: number;
  size: number;
  maxWidth: number;
  accents?: Readonly<Record<string, string>>;
  punch?: number;
}) {
  if (frame < from || frame > to) return null;
  const lines = wrap(text, size, maxWidth);
  const leading = size * 1.02;
  const total = [...text.replace(/\s/g, "")].length;
  const stagger = Math.min(1.4, 16 / Math.max(1, total));
  const exit = ramp(frame, to - 10, to, EASE.inCubic);
  const land = punch ? ramp(frame, from, from + 10, EASE.outBack) : 1;
  const hit = punch * Math.max(0, 1 - Math.abs(frame - from - 9) / 7);
  const scale = lerp(1.25, 1, land) + hit * 0.06;
  const letters: ReactNode[] = [];
  const glows: ReactNode[] = [];
  let index = 0;
  lines.forEach((line, row) => {
    const width = measure(line, size);
    let cursor = x - width / 2;
    const baseline = y + row * leading;
    for (const word of line.split(" ")) {
      const key = word.replace(/[^\p{L}]/gu, "").toUpperCase();
      const color = accents[key] ?? COLORS.text;
      for (const ch of word) {
        const start = from + index * stagger;
        const t = ramp(frame, start, start + 12, EASE.outBack);
        const o = ramp(frame, start, start + 6, EASE.outCubic);
        const w = measure(ch, size);
        const lift =
          (1 - t) * size * 0.55 - exit * size * 0.35 * (1 + (index % 3) * 0.2);
        const cx = cursor + w / 2;
        letters.push(
          <text
            key={`${row}-${index}`}
            x={cx}
            y={baseline + lift}
            textAnchor="middle"
            fontFamily={FONT}
            fontWeight={850}
            fontSize={size}
            fill={color}
            opacity={o * (1 - exit)}
            transform={`rotate(${(1 - t) * -8} ${cx} ${baseline})`}
          >
            {ch}
          </text>,
        );
        if (color !== COLORS.text) {
          glows.push(
            <text
              key={`g${row}-${index}`}
              x={cx}
              y={baseline + lift}
              textAnchor="middle"
              fontFamily={FONT}
              fontWeight={850}
              fontSize={size}
              fill={color}
              opacity={0.55 * o * (1 - exit)}
            >
              {ch}
            </text>,
          );
        }
        cursor += w;
        index += 1;
      }
      cursor += measure(" ", size);
    }
  });
  const bar = ramp(frame, from + 6, from + 20, EASE.outCubic) * (1 - exit);
  const barY = y + (lines.length - 1) * leading + size * 0.36;
  return (
    <g
      transform={`translate(${x} ${y}) scale(${scale}) translate(${-x} ${-y})`}
    >
      <g filter="url(#cinemaGlow)">{glows}</g>
      {/* A soft shadow keeps letters readable over bright parts. */}
      <g filter="url(#cinemaShadow)" opacity={0.7}>
        {letters}
      </g>
      {letters}
      <rect
        x={x - 70 * bar}
        y={barY}
        width={140 * bar}
        height={9}
        rx={4.5}
        fill={COLORS.primary}
      />
    </g>
  );
}

/** Filters the type uses; put once in the overlay's <defs>. */
export function TypeDefs() {
  return (
    <defs>
      <filter id="cinemaGlow" x="-30%" y="-60%" width="160%" height="220%">
        <feGaussianBlur stdDeviation="14" />
      </filter>
      <filter id="cinemaShadow" x="-20%" y="-40%" width="140%" height="180%">
        <feGaussianBlur stdDeviation="8" />
        <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.9 0" />
      </filter>
      <filter id="cinemaSoft" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="10" />
      </filter>
    </defs>
  );
}

/** A rounded label with a coloured dot, or filled for emphasis. */
export function Chip({
  x,
  y,
  text,
  color,
  size = 30,
  opacity = 1,
  filled = false,
  rise = 0,
}: {
  x: number;
  y: number;
  text: string;
  color: string;
  size?: number;
  opacity?: number;
  filled?: boolean;
  /** 0..1 of the entrance, for a small rise. */
  rise?: number;
}) {
  if (opacity <= 0.01) return null;
  const textWidth = measure(text, size, 800) + text.length * size * 0.06;
  const w = textWidth + size * (filled ? 1.6 : 2.4);
  const h = size * 1.8;
  const left = x - w / 2;
  const top = y - h / 2 + (1 - rise) * 16;
  return (
    <g opacity={opacity}>
      <rect
        x={left}
        y={top}
        width={w}
        height={h}
        rx={h / 2}
        fill={filled ? color : COLORS.panel}
        fillOpacity={filled ? 1 : 0.82}
        stroke={color}
        strokeOpacity={filled ? 0 : 0.6}
        strokeWidth={2}
      />
      {!filled && (
        <circle
          cx={left + size * 0.95}
          cy={top + h / 2}
          r={size * 0.22}
          fill={color}
        />
      )}
      <text
        x={filled ? x : left + size * 1.55 + textWidth / 2}
        y={top + h / 2 + size * 0.36}
        textAnchor="middle"
        fontFamily={FONT}
        fontWeight={800}
        fontSize={size}
        letterSpacing={size * 0.06}
        fill={filled ? COLORS.background : COLORS.text}
      >
        {text}
      </text>
    </g>
  );
}

/** A label pinned to a point in the picture, with a short leader line. */
export function Callout({
  x,
  y,
  text,
  color,
  opacity,
  side = 1,
  offset,
}: {
  x: number;
  y: number;
  text: string;
  color: string;
  opacity: number;
  /** 1 puts the label above-right, -1 below-left. */
  side?: 1 | -1;
  /** Where the label sits from the point, in pixels, instead of `side`. */
  offset?: { x: number; y: number };
}) {
  if (opacity <= 0.01) return null;
  const dx = offset?.x ?? 70 * side;
  const dy = offset?.y ?? -90 * side;
  const lx = x + dx;
  const ly = y + dy;
  return (
    <g opacity={opacity}>
      <circle cx={x} cy={y} r={9} fill={color} />
      <circle
        cx={x}
        cy={y}
        r={20}
        fill="none"
        stroke={color}
        strokeOpacity={0.5}
        strokeWidth={3}
      />
      <line
        x1={x}
        y1={y}
        x2={lx}
        y2={ly}
        stroke={color}
        strokeWidth={3}
        strokeOpacity={0.8}
      />
      <Chip
        x={lx + (dx >= 0 ? 1 : -1) * (measure(text, 30, 800) / 2 + 50)}
        y={ly}
        text={text}
        color={color}
        rise={opacity}
      />
    </g>
  );
}

export { COLORS, FONT, measure, mix, wrap };
