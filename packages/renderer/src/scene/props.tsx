/**
 * Props a scene can place, drawn in a flat, warm style that matches the
 * mascot: a candle, a lantern, a crate. Each stands on (x, y) and is
 * `size` tall; a flame flickers from the frame number alone.
 */
import type { SceneNode } from "@framebop/core";
import { clamp } from "../animation/timing";

/** A flame's flicker at a frame, -1 to 1: two slow waves, never random. */
export function flickerAt(frame: number): number {
  return clamp(
    0.6 * Math.sin(frame * 0.71) + 0.4 * Math.sin(frame * 1.93 + 1.7),
    -1,
    1,
  );
}

export function Prop({
  kind,
  x,
  y,
  size,
  flicker,
  frame,
  id,
}: {
  kind: Extract<SceneNode, { type: "prop" }>["kind"];
  x: number;
  y: number;
  size: number;
  flicker: number;
  frame: number;
  id: string;
}) {
  const h = size;
  const f = 1 + flickerAt(frame) * 0.08 * flicker;
  switch (kind) {
    case "candle": {
      const w = h * 0.26;
      const body = h * 0.62;
      return (
        <g>
          <rect
            x={x - w / 2}
            y={y - body}
            width={w}
            height={body}
            rx={w * 0.18}
            fill="#F3E6CF"
          />
          <rect
            x={x - w / 2}
            y={y - body}
            width={w * 0.32}
            height={body}
            rx={w * 0.12}
            fill="#FFFFFF"
            opacity={0.35}
          />
          <Flame id={id} x={x} y={y - body} h={h * 0.34 * f} />
        </g>
      );
    }
    case "lantern": {
      // Its light (the flame's heart) sits a third of its height up.
      const w = h * 0.62;
      const glass = h * 0.5;
      const base = h * 0.12;
      return (
        <g>
          <defs>
            <radialGradient id={`${id}glass`} cx="0.5" cy="0.62" r="0.6">
              <stop offset="0" stopColor="#FFF4D6" />
              <stop offset="0.45" stopColor="#FFB347" stopOpacity={0.9} />
              <stop offset="1" stopColor="#FF7A1F" stopOpacity={0.35} />
            </radialGradient>
          </defs>
          <rect
            x={x - w / 2}
            y={y - base}
            width={w}
            height={base}
            rx={base * 0.3}
            fill="#2B2420"
          />
          <rect
            x={x - w * 0.42}
            y={y - base - glass}
            width={w * 0.84}
            height={glass}
            rx={w * 0.12}
            fill={`url(#${id}glass)`}
            opacity={Math.min(1, 0.82 + (f - 1) * 1.5)}
          />
          <Flame id={id} x={x} y={y - h * 0.24} h={h * 0.2 * f} />
          {[-0.42, 0.42].map((s) => (
            <rect
              key={s}
              x={x + w * s - w * 0.05}
              y={y - base - glass}
              width={w * 0.1}
              height={glass}
              fill="#2B2420"
            />
          ))}
          <path
            d={`M ${x - w * 0.5} ${y - base - glass} L ${x} ${y - h * 0.86} L ${x + w * 0.5} ${y - base - glass} Z`}
            fill="#2B2420"
          />
          <circle
            cx={x}
            cy={y - h * 0.9}
            r={h * 0.07}
            fill="none"
            stroke="#2B2420"
            strokeWidth={h * 0.035}
          />
        </g>
      );
    }
    case "crate": {
      const w = h * 1.1;
      return (
        <g>
          <rect
            x={x - w / 2}
            y={y - h}
            width={w}
            height={h}
            rx={h * 0.04}
            fill="#5A4030"
          />
          <path
            d={`M ${x - w / 2} ${y - h} L ${x + w / 2} ${y} M ${x + w / 2} ${y - h} L ${x - w / 2} ${y}`}
            stroke="#3E2B20"
            strokeWidth={h * 0.08}
          />
          <rect
            x={x - w / 2}
            y={y - h}
            width={w}
            height={h}
            rx={h * 0.04}
            fill="none"
            stroke="#3E2B20"
            strokeWidth={h * 0.1}
          />
        </g>
      );
    }
  }
}

function Flame({
  id,
  x,
  y,
  h,
}: {
  id: string;
  x: number;
  y: number;
  h: number;
}) {
  const w = h * 0.5;
  return (
    <g>
      <defs>
        <radialGradient id={`${id}flame`} cx="0.5" cy="0.7" r="0.6">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="0.4" stopColor="#FFE08A" />
          <stop offset="1" stopColor="#FF7A1F" />
        </radialGradient>
      </defs>
      <path
        d={`M ${x} ${y - h} C ${x + w * 0.7} ${y - h * 0.45}, ${x + w * 0.55} ${y}, ${x} ${y} C ${x - w * 0.55} ${y}, ${x - w * 0.7} ${y - h * 0.45}, ${x} ${y - h} Z`}
        fill={`url(#${id}flame)`}
      />
    </g>
  );
}
