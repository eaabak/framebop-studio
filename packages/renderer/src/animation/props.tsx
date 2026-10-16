/**
 * Procedural vector props, drawn from simple shapes. Each is drawn with its
 * base on the origin (the paving hangs below it) and may move inside itself
 * with time: cloth flutters, fire flickers, birds flap.
 */
import type { PropAsset, PropMotion } from "@framebop/core";
import type { ReactElement } from "react";
import { clamp, hash, noise } from "./timing";

const { PI, sin, round, max } = Math;

/** A colour mixed towards black (negative) or white (positive). */
export function shade(color: string, amount: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return color;
  const value = Number.parseInt(match[1]!, 16);
  const target = amount < 0 ? 0 : 255;
  const t = Math.abs(amount);
  const channel = (shift: number) =>
    round(((value >> shift) & 255) * (1 - t) + target * t);
  return `rgb(${channel(16)},${channel(8)},${channel(0)})`;
}

interface PropProps {
  asset: PropAsset;
  time: number;
  motion: PropMotion | null;
  seed: number;
  /** Where the animation's pictures can be loaded from, by key. */
  urls: Readonly<Record<string, string>>;
}

const points = (list: [number, number][]) =>
  list.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

function Hill({
  asset: { width: w, height: h, color, accent },
  seed,
}: PropProps) {
  const curve = (x: number) => -h * (1 - (2 * x) ** 2 / (w * w)) * 0.92;
  const trees = [0, 1, 2, 3].map((i) => {
    const x = (hash(i, seed) - 0.5) * w * 0.6;
    return { x, y: curve(x) + 6, size: 0.6 + hash(i + 9, seed) * 0.5 };
  });
  return (
    <g>
      <path
        d={`M ${-w / 2} 0 C ${-w * 0.28} ${-h * 1.05}, ${w * 0.22} ${-h * 1.1}, ${w / 2} 0 Z`}
        fill={color}
      />
      {trees.map((tree, i) => (
        <ellipse
          key={i}
          cx={tree.x}
          cy={tree.y - h * 0.16 * tree.size}
          rx={w * 0.012 * tree.size}
          ry={h * 0.17 * tree.size}
          fill={accent}
        />
      ))}
    </g>
  );
}

function Temple({ asset: { width: w, height: h, color, accent } }: PropProps) {
  const base = h * 0.14;
  const columnTop = -h * 0.66;
  const columns = 6;
  return (
    <g>
      <rect
        x={-w / 2}
        y={-base}
        width={w}
        height={base}
        fill={shade(color, -0.12)}
      />
      <rect
        x={-w * 0.47}
        y={-base - h * 0.04}
        width={w * 0.94}
        height={h * 0.04}
        fill={color}
      />
      {Array.from({ length: columns }, (_, i) => {
        const x = -w * 0.4 + (i * w * 0.8) / (columns - 1);
        return (
          <rect
            key={i}
            x={x - w * 0.028}
            y={columnTop}
            width={w * 0.056}
            height={-base - h * 0.04 - columnTop}
            fill={color}
          />
        );
      })}
      <rect
        x={-w * 0.48}
        y={columnTop - h * 0.08}
        width={w * 0.96}
        height={h * 0.08}
        fill={shade(color, -0.06)}
      />
      <polygon
        points={points([
          [-w * 0.5, columnTop - h * 0.08],
          [0, -h],
          [w * 0.5, columnTop - h * 0.08],
        ])}
        fill={accent}
      />
      <polygon
        points={points([
          [-w * 0.4, columnTop - h * 0.1],
          [0, -h * 0.93],
          [w * 0.4, columnTop - h * 0.1],
        ])}
        fill={shade(color, -0.04)}
      />
    </g>
  );
}

function Cloud({ asset: { width: w, height: h, color } }: PropProps) {
  return (
    <g opacity={0.92}>
      <ellipse cx={0} cy={-h * 0.45} rx={w * 0.5} ry={h * 0.32} fill={color} />
      <ellipse
        cx={-w * 0.18}
        cy={-h * 0.62}
        rx={w * 0.22}
        ry={h * 0.33}
        fill={color}
      />
      <ellipse
        cx={w * 0.12}
        cy={-h * 0.7}
        rx={w * 0.25}
        ry={h * 0.3}
        fill={color}
      />
      <ellipse
        cx={0}
        cy={-h * 0.3}
        rx={w * 0.46}
        ry={h * 0.16}
        fill={shade(color, -0.06)}
      />
    </g>
  );
}

function Building({
  asset: { width: w, height: h, color, accent },
  seed,
}: PropProps) {
  const floors = max(1, round((h - 40) / 120));
  const columns = max(1, round(w / 95));
  const floorHeight = (h - 30) / (floors + 0.6);
  const windows: ReactElement[] = [];
  for (let f = 1; f <= floors; f += 1) {
    for (let c = 0; c < columns; c += 1) {
      const x = -w / 2 + ((c + 0.5) * w) / columns;
      const y = -h + 30 + (f - 1) * floorHeight + floorHeight * 0.3;
      const open = hash(f * 17 + c, seed) > 0.35;
      windows.push(
        <g key={`${f}-${c}`}>
          <rect
            x={x - 16}
            y={y}
            width={32}
            height={floorHeight * 0.45}
            fill={open ? "#3a2a24" : shade(accent, -0.1)}
          />
          {!open && (
            <line
              x1={x}
              y1={y}
              x2={x}
              y2={y + floorHeight * 0.45}
              stroke={shade(accent, -0.35)}
              strokeWidth={2}
            />
          )}
        </g>,
      );
    }
  }
  return (
    <g>
      <rect x={-w / 2} y={-h} width={w} height={h} fill={color} />
      <rect
        x={-w / 2}
        y={-h * 0.24}
        width={w}
        height={h * 0.24}
        fill={shade(color, -0.08)}
      />
      <polygon
        points={points([
          [-w / 2 - 14, -h],
          [w / 2 + 14, -h],
          [w / 2 - 6, -h - 26],
          [-w / 2 + 6, -h - 26],
        ])}
        fill={accent}
      />
      {windows}
      <path
        d={`M ${-w * 0.16} 0 L ${-w * 0.16} ${-h * 0.15} A ${w * 0.16} ${w * 0.16} 0 0 1 ${w * 0.16} ${-h * 0.15} L ${w * 0.16} 0 Z`}
        fill="#2e211c"
      />
    </g>
  );
}

function Arch({ asset: { width: w, height: h, color, accent } }: PropProps) {
  const r = w * 0.3;
  return (
    <g>
      <path
        d={`M ${-w / 2} 0 L ${-w / 2} ${-h} L ${w / 2} ${-h} L ${w / 2} 0 L ${r} 0 L ${r} ${-h + r + h * 0.22} A ${r} ${r} 0 0 0 ${-r} ${-h + r + h * 0.22} L ${-r} 0 Z`}
        fill={color}
      />
      <rect
        x={-w / 2 - 8}
        y={-h - 16}
        width={w + 16}
        height={18}
        fill={accent}
      />
    </g>
  );
}

function Paving({
  asset: { width: w, height: h, color, accent },
  seed,
}: PropProps) {
  // Rows of stones, deeper towards the viewer.
  const bands = [0, 0.1, 0.24, 0.42, 0.66, 1].map((f) => f * h);
  const joints: ReactElement[] = [];
  for (let b = 0; b < bands.length - 1; b += 1) {
    const top = bands[b]!;
    const bottom = bands[b + 1]!;
    const spacing = (bottom - top) * 2.3;
    const offset = hash(b, seed) * spacing;
    for (let x = -w / 2 + offset; x < w / 2; x += spacing) {
      const jitter = (hash(round(x), seed + b) - 0.5) * spacing * 0.4;
      joints.push(
        <line
          key={`${b}-${round(x)}`}
          x1={x + jitter}
          y1={top}
          x2={x + jitter * 1.1}
          y2={bottom}
          stroke={accent}
          strokeWidth={2 + b}
          strokeOpacity={0.55}
        />,
      );
    }
  }
  return (
    <g>
      <rect x={-w / 2} y={0} width={w} height={h} fill={color} />
      <rect
        x={-w / 2}
        y={-8}
        width={w}
        height={10}
        fill={shade(color, -0.25)}
      />
      {bands.slice(1, -1).map((y) => (
        <line
          key={y}
          x1={-w / 2}
          y1={y}
          x2={w / 2}
          y2={y}
          stroke={accent}
          strokeWidth={3}
          strokeOpacity={0.5}
        />
      ))}
      {joints}
    </g>
  );
}

/** Cloth that ripples along its lower edge. */
function rippledEdge(
  from: number,
  to: number,
  y: number,
  time: number,
  motion: PropMotion | null,
): [number, number][] {
  const amplitude = motion?.kind === "flutter" ? motion.amplitude : 0;
  const period = motion?.period ?? 60;
  const steps = 16;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const x = from + ((to - from) * i) / steps;
    const ripple =
      amplitude *
      (sin(2 * PI * (time / period) + x * 0.025) * 0.7 +
        noise(time / 20 + i * 0.4, 5) * 0.3);
    return [x, y + ripple + (i % 2 === 0 ? 0 : 7)];
  });
}

function Stall({
  asset: { width: w, height: h, color, accent },
  time,
  motion,
}: PropProps) {
  const counterTop = -h * 0.36;
  const awningTop = -h;
  const awningBottom = -h * 0.8;
  const edge = rippledEdge(-w * 0.55, w * 0.55, awningBottom, time, motion);
  const stripes = 10;
  return (
    <g>
      <rect
        x={-w * 0.44}
        y={awningTop}
        width={12}
        height={h}
        fill={shade(color, -0.3)}
      />
      <rect
        x={w * 0.44 - 12}
        y={awningTop}
        width={12}
        height={h}
        fill={shade(color, -0.3)}
      />
      <rect
        x={-w * 0.47}
        y={counterTop}
        width={w * 0.94}
        height={-counterTop}
        fill={color}
      />
      <rect
        x={-w * 0.49}
        y={counterTop - 12}
        width={w * 0.98}
        height={14}
        fill={shade(color, -0.2)}
      />
      {[0.33, 0.66].map((f) => (
        <line
          key={f}
          x1={-w * 0.47}
          y1={counterTop * (1 - f)}
          x2={w * 0.47}
          y2={counterTop * (1 - f)}
          stroke={shade(color, -0.25)}
          strokeWidth={3}
        />
      ))}
      {Array.from({ length: stripes }, (_, i) => {
        const a = edge[round((i * 16) / stripes)]!;
        const b = edge[round(((i + 1) * 16) / stripes)]!;
        const x0 = -w * 0.5 + (i * w) / stripes;
        const x1 = -w * 0.5 + ((i + 1) * w) / stripes;
        return (
          <polygon
            key={i}
            points={points([
              [x0, awningTop],
              [x1, awningTop],
              [b[0], b[1]],
              [a[0], a[1]],
            ])}
            fill={i % 2 === 0 ? accent : "#efe3c8"}
          />
        );
      })}
      <polyline
        points={points(edge)}
        fill="none"
        stroke={shade(accent, -0.3)}
        strokeWidth={4}
      />
    </g>
  );
}

function Basket({
  asset: { width: w, height: h, color, accent },
  seed,
}: PropProps) {
  const fruit = Array.from({ length: 9 }, (_, i) => ({
    x: (hash(i, seed) - 0.5) * w * 0.75,
    y: -h * 0.95 - hash(i + 20, seed) * h * 0.3 * (1 - Math.abs(i - 4) / 5),
    r: w * (0.09 + hash(i + 40, seed) * 0.03),
  }));
  return (
    <g>
      {fruit.map((f, i) => (
        <g key={i}>
          <circle cx={f.x} cy={f.y} r={f.r} fill={accent} />
          <circle
            cx={f.x - f.r * 0.3}
            cy={f.y - f.r * 0.35}
            r={f.r * 0.25}
            fill="#ffffff"
            opacity={0.25}
          />
        </g>
      ))}
      <path
        d={`M ${-w / 2} ${-h} L ${w / 2} ${-h} L ${w * 0.38} 0 L ${-w * 0.38} 0 Z`}
        fill={color}
      />
      {[0.25, 0.5, 0.75].map((f) => (
        <line
          key={f}
          x1={-w * (0.5 - 0.12 * f)}
          y1={-h * (1 - f)}
          x2={w * (0.5 - 0.12 * f)}
          y2={-h * (1 - f)}
          stroke={shade(color, -0.3)}
          strokeWidth={3}
        />
      ))}
      <rect
        x={-w / 2 - 4}
        y={-h - 6}
        width={w + 8}
        height={10}
        rx={5}
        fill={shade(color, -0.15)}
      />
    </g>
  );
}

function Amphora({ asset: { width: w, height: h, color, accent } }: PropProps) {
  return (
    <g>
      <path
        d={`M ${-w * 0.12} ${-h} L ${w * 0.12} ${-h} L ${w * 0.14} ${-h * 0.82} C ${w * 0.62} ${-h * 0.7}, ${w * 0.5} ${-h * 0.25}, ${w * 0.06} 0 L ${-w * 0.06} 0 C ${-w * 0.5} ${-h * 0.25}, ${-w * 0.62} ${-h * 0.7}, ${-w * 0.14} ${-h * 0.82} Z`}
        fill={color}
      />
      <path
        d={`M ${-w * 0.13} ${-h * 0.9} C ${-w * 0.45} ${-h * 0.9}, ${-w * 0.45} ${-h * 0.72}, ${-w * 0.3} ${-h * 0.68}`}
        fill="none"
        stroke={shade(color, -0.2)}
        strokeWidth={w * 0.06}
      />
      <path
        d={`M ${w * 0.13} ${-h * 0.9} C ${w * 0.45} ${-h * 0.9}, ${w * 0.45} ${-h * 0.72}, ${w * 0.3} ${-h * 0.68}`}
        fill="none"
        stroke={shade(color, -0.2)}
        strokeWidth={w * 0.06}
      />
      <path
        d={`M ${-w * 0.36} ${-h * 0.55} Q 0 ${-h * 0.5} ${w * 0.36} ${-h * 0.55}`}
        fill="none"
        stroke={accent}
        strokeWidth={w * 0.05}
      />
    </g>
  );
}

function Brazier({ asset: { width: w, height: h, color }, time }: PropProps) {
  const bowl = -h * 0.55;
  const flames = [-0.18, 0, 0.17].map((x, i) => {
    const flicker =
      0.75 + 0.25 * noise(time / 3 + i * 5, 31) + 0.1 * sin(time * 0.9 + i);
    return { x: x * w, height: h * 0.42 * flicker * (i === 1 ? 1.2 : 0.85) };
  });
  const smoke = [0, 1, 2, 3, 4].map((i) => {
    const age = (time / 70 + i / 5) % 1;
    return {
      x: sin(age * 4 + i) * w * 0.15 + age * w * 0.3,
      y: bowl - h * 0.5 - age * h * 1.6,
      r: w * (0.08 + age * 0.22),
      opacity: 0.22 * (1 - age) * clamp(age * 6),
    };
  });
  const glow = 0.18 + 0.06 * noise(time / 4, 7);
  return (
    <g>
      {[1, 0.72, 0.45].map((r) => (
        <circle
          key={r}
          cx={0}
          cy={bowl - h * 0.15}
          r={w * r}
          fill="#ffb347"
          opacity={glow * 0.45}
        />
      ))}
      {[-0.32, 0.32].map((x) => (
        <line
          key={x}
          x1={x * w}
          y1={0}
          x2={x * w * 0.6}
          y2={bowl}
          stroke={shade(color, -0.2)}
          strokeWidth={6}
        />
      ))}
      {flames.map((flame, i) => (
        <g key={i}>
          <path
            d={`M ${flame.x - w * 0.12} ${bowl} Q ${flame.x - w * 0.1} ${bowl - flame.height * 0.6} ${flame.x + w * 0.02 * sin(time / 4 + i)} ${bowl - flame.height} Q ${flame.x + w * 0.1} ${bowl - flame.height * 0.5} ${flame.x + w * 0.12} ${bowl} Z`}
            fill="#f07b22"
          />
          <path
            d={`M ${flame.x - w * 0.06} ${bowl} Q ${flame.x - w * 0.04} ${bowl - flame.height * 0.4} ${flame.x} ${bowl - flame.height * 0.65} Q ${flame.x + w * 0.05} ${bowl - flame.height * 0.3} ${flame.x + w * 0.06} ${bowl} Z`}
            fill="#ffd45c"
          />
        </g>
      ))}
      <path
        d={`M ${-w * 0.42} ${bowl} L ${w * 0.42} ${bowl} L ${w * 0.3} ${bowl + h * 0.14} L ${-w * 0.3} ${bowl + h * 0.14} Z`}
        fill={color}
      />
      {smoke.map((puff, i) => (
        <circle
          key={i}
          cx={puff.x}
          cy={puff.y}
          r={puff.r}
          fill="#d8d2c8"
          opacity={puff.opacity}
        />
      ))}
    </g>
  );
}

function Banner({
  asset: { width: w, height: h, color, accent },
  time,
  motion,
}: PropProps) {
  const amplitude = motion?.kind === "flutter" ? motion.amplitude : 0;
  const period = motion?.period ?? 60;
  const steps = 10;
  const side = (x0: number) =>
    Array.from({ length: steps + 1 }, (_, i): [number, number] => {
      const y = -h + (i * h * 0.92) / steps;
      const along = i / steps;
      return [
        x0 + amplitude * along * sin(2 * PI * (time / period) - along * 2.5),
        y,
      ];
    });
  const left = side(-w / 2);
  const right = side(w / 2).reverse();
  const tip: [number, number] = [left[steps]![0] + w / 2, -h * 0.02];
  return (
    <g>
      <line
        x1={-w * 0.65}
        y1={-h}
        x2={w * 0.65}
        y2={-h}
        stroke="#5a3d2b"
        strokeWidth={8}
      />
      <polygon points={points([...left, tip, ...right])} fill={color} />
      <circle
        cx={tip[0] * 0.6}
        cy={-h * 0.55}
        r={w * 0.18}
        fill="none"
        stroke={accent}
        strokeWidth={6}
      />
    </g>
  );
}

function Column({ asset: { width: w, height: h, color, accent } }: PropProps) {
  return (
    <g>
      <rect
        x={-w / 2}
        y={-h * 0.05}
        width={w}
        height={h * 0.05}
        fill={shade(color, -0.1)}
      />
      <rect
        x={-w * 0.38}
        y={-h * 0.93}
        width={w * 0.76}
        height={h * 0.88}
        fill={color}
      />
      {[-0.22, 0, 0.22].map((x) => (
        <line
          key={x}
          x1={x * w}
          y1={-h * 0.92}
          x2={x * w}
          y2={-h * 0.06}
          stroke={accent}
          strokeWidth={w * 0.05}
          strokeOpacity={0.6}
        />
      ))}
      <rect
        x={-w * 0.55}
        y={-h}
        width={w * 1.1}
        height={h * 0.07}
        fill={shade(color, -0.08)}
      />
    </g>
  );
}

function Plant({
  asset: { width: w, height: h, color, accent },
  time,
  seed,
}: PropProps) {
  const leaves = Array.from({ length: 7 }, (_, i) => {
    const angle = -70 + i * 23 + 6 * sin(time / 25 + i + seed * 10);
    return { angle, length: h * (0.45 + hash(i, seed) * 0.25) };
  });
  return (
    <g>
      {leaves.map((leaf, i) => (
        <ellipse
          key={i}
          cx={0}
          cy={-leaf.length / 2}
          rx={w * 0.12}
          ry={leaf.length / 2}
          fill={i % 2 ? color : shade(color, -0.15)}
          transform={`translate(0 ${-h * 0.35}) rotate(${leaf.angle})`}
        />
      ))}
      <path
        d={`M ${-w * 0.32} ${-h * 0.38} L ${w * 0.32} ${-h * 0.38} L ${w * 0.24} 0 L ${-w * 0.24} 0 Z`}
        fill={accent}
      />
      <rect
        x={-w * 0.36}
        y={-h * 0.42}
        width={w * 0.72}
        height={h * 0.06}
        fill={shade(accent, -0.15)}
      />
    </g>
  );
}

function Bird({ asset: { width: w, color }, time, motion }: PropProps) {
  const flap = sin(time * 0.55 + (motion?.phase ?? 0) * 7);
  const lift = w * 0.35 * flap;
  return (
    <path
      d={`M ${-w / 2} ${-lift} Q ${-w / 4} ${-w * 0.25 - lift * 0.4} 0 0 Q ${w / 4} ${-w * 0.25 - lift * 0.4} ${w / 2} ${-lift}`}
      fill="none"
      stroke={color}
      strokeWidth={w * 0.09}
      strokeLinecap="round"
    />
  );
}

function Cat({
  asset: { width: w, height: h, color, accent },
  time,
  motion,
}: PropProps) {
  const tail = sin(time / 7) * 12;
  const popped = motion?.kind === "pop" ? clamp((time - motion.at) / 6) : 1;
  return (
    <g>
      <path
        d={`M ${-w * 0.3} ${-h * 0.15} C ${-w * 0.65} ${-h * 0.3}, ${-w * 0.6} ${-h * 0.75}, ${-w * 0.5 + tail * 0.5} ${-h * 0.9}`}
        fill="none"
        stroke={color}
        strokeWidth={w * 0.09}
        strokeLinecap="round"
      />
      <ellipse cx={0} cy={-h * 0.33} rx={w * 0.34} ry={h * 0.33} fill={color} />
      <circle cx={w * 0.2} cy={-h * 0.72} r={w * 0.24} fill={color} />
      <polygon
        points={points([
          [w * 0.04, -h * 0.82],
          [w * 0.1, -h * 1.02],
          [w * 0.2, -h * 0.9],
        ])}
        fill={color}
      />
      <polygon
        points={points([
          [w * 0.24, -h * 0.9],
          [w * 0.36, -h * 1.03],
          [w * 0.4, -h * 0.8],
        ])}
        fill={color}
      />
      <circle
        cx={w * 0.3}
        cy={-h * 0.75}
        r={w * (0.035 + 0.025 * popped)}
        fill={accent}
      />
      <circle cx={w * 0.31} cy={-h * 0.75} r={w * 0.02} fill="#1d1d1d" />
      <line
        x1={w * 0.36}
        y1={-h * 0.66}
        x2={w * 0.6}
        y2={-h * 0.68}
        stroke="#e8e0d0"
        strokeWidth={2}
      />
      <line
        x1={w * 0.36}
        y1={-h * 0.64}
        x2={w * 0.58}
        y2={-h * 0.6}
        stroke="#e8e0d0"
        strokeWidth={2}
      />
    </g>
  );
}

/** A picture, stretched to the prop's size with its base on the origin. */
function Picture({ asset: { width: w, height: h, image }, urls }: PropProps) {
  const url = image ? urls[image] : undefined;
  if (!url) return <g />;
  return (
    <image
      href={url}
      x={-w / 2}
      y={-h}
      width={w}
      height={h}
      preserveAspectRatio="none"
    />
  );
}

const DRAWINGS: Record<PropAsset["kind"], (props: PropProps) => ReactElement> =
  {
    hill: Hill,
    temple: Temple,
    cloud: Cloud,
    building: Building,
    arch: Arch,
    paving: Paving,
    stall: Stall,
    basket: Basket,
    amphora: Amphora,
    brazier: Brazier,
    banner: Banner,
    column: Column,
    plant: Plant,
    bird: Bird,
    cat: Cat,
    image: Picture,
  };

export function Prop(props: PropProps) {
  const Drawing = DRAWINGS[props.asset.kind];
  return <Drawing {...props} />;
}
