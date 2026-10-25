/**
 * Headlines in the clean and cinematic styles: whole lines that fade,
 * slide or cut in and out (the direction's transition), laid out exactly
 * as the layout check measures them. The kinetic style is KineticTitle's.
 */
import { EASE } from "../animation/timing";
import { COLORS, FONT } from "../cinema/palette";
import { ramp } from "../cinema/type";
import { type HeadlineLayout, TITLE_STYLES } from "./evaluate";

export function StyledTitle({
  layout,
  style,
  transition,
  frame,
  from,
  to,
  x,
  y,
  punch,
}: {
  layout: HeadlineLayout;
  style: "clean" | "cinematic";
  transition: "cut" | "fade" | "slide";
  frame: number;
  from: number;
  to: number;
  x: number;
  y: number;
  punch: number;
}) {
  if (frame < from || frame > to) return null;
  const { tracking, weight } = TITLE_STYLES[style];
  const inFrames = style === "cinematic" ? 18 : 10;
  const enter =
    transition === "cut"
      ? 1
      : ramp(frame, from, from + inFrames, EASE.outCubic);
  const leave =
    transition === "cut" ? 0 : ramp(frame, to - 10, to, EASE.inCubic);
  const shown = Math.min(enter, 1 - leave);
  const dx = transition === "slide" ? (1 - enter) * 70 - leave * 70 : 0;
  const dy = transition === "fade" && style === "clean" ? (1 - enter) * 18 : 0;
  // Results land with a short pop of scale.
  const pop =
    punch * Math.max(0, 1 - Math.abs(frame - from - inFrames / 2) / inFrames);
  const scale = (style === "cinematic" ? 1.04 - 0.04 * enter : 1) + pop * 0.1;
  const spacing = tracking * layout.size;
  const blur = style === "cinematic" ? (1 - enter) * 6 : 0;
  const last = y + (layout.lines - 1) * layout.leading;
  return (
    <g
      opacity={shown}
      transform={`translate(${x + dx} ${y + dy}) scale(${scale}) translate(${-x} ${-y})`}
      style={blur > 0.05 ? { filter: `blur(${blur}px)` } : undefined}
    >
      {layout.rows.map((row, i) => (
        <text
          key={i}
          // SVG adds the spacing after every letter, the last one too.
          x={x + spacing / 2}
          y={y + i * layout.leading}
          textAnchor="middle"
          fontFamily={FONT}
          fontWeight={weight}
          fontSize={layout.size}
          letterSpacing={spacing}
          fill={COLORS.text}
        >
          {row}
        </text>
      ))}
      <rect
        x={x - (style === "cinematic" ? 26 : 34)}
        y={last + layout.size * 0.36}
        width={style === "cinematic" ? 52 : 68}
        height={style === "cinematic" ? 4 : 7}
        rx={3}
        fill={COLORS.primary}
        opacity={enter}
      />
    </g>
  );
}
