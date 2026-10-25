/**
 * Draws any scene graph at a frame, in SVG with the cinema kit: materials
 * with gradients and glows, primitives back to front inside a camera (each
 * layer at its own parallax), props, characters and their silhouettes, a
 * room, the light's atmosphere, and headlines in the graph's typography.
 * There is no code per scene: this one component draws every graph, from
 * the graph alone.
 */
import type { SceneLab, SceneMaterial, SceneNode } from "@framebop/core";
import { type ReactNode, createContext, useContext } from "react";
import type { Hold } from "../animation/PixiScene";
import { Mascot } from "../cinema/mascot";
import { COLORS, FONT, SAFE } from "../cinema/palette";
import { Chip, KineticTitle, TypeDefs, during } from "../cinema/type";
import { useFontsReady, useHold } from "../cinema/WebGLScene";
import {
  HEADLINE_WIDTH,
  HEADLINE_Y,
  type SceneCamera,
  type SceneContext,
  type SceneWords,
  cameraAt,
  fillText,
  frameOf,
  headlineLayout,
  layerCamera,
  sceneContext,
  trackAt,
} from "./evaluate";
import { Prop, flickerAt } from "./props";
import { StyledTitle } from "./titles";

type Words = SceneWords;

export function SceneView({
  lab,
  frame,
  hold,
}: {
  lab: SceneLab;
  frame: number;
  hold?: () => Hold;
}) {
  useHold(hold, useFontsReady(`850 100px ${FONT}`));
  const ctx = sceneContext(lab);
  const { graph } = lab;
  const { words } = ctx;
  const color = (token: string) =>
    token === "$primary"
      ? lab.style.primary
      : token === "$secondary"
        ? lab.style.secondary
        : token === "$text"
          ? COLORS.text
          : token === "$dim"
            ? COLORS.dim
            : token === "$background"
              ? COLORS.background
              : token;
  const { width: W, height: H } = graph;
  const f = frame;
  const cam = cameraAt(ctx, f, lab.camera === "still");
  // Each node through the camera as its layer sees it.
  const through = (c: SceneCamera) =>
    `translate(${W / 2} ${H / 2}) scale(${c.zoom}) translate(${-c.x} ${-c.y})`;
  const nodes = graph.nodes.map((node, i) => {
    const drawn = draw(node, ctx, f, words, `n${i}`);
    return drawn ? (
      <g
        key={`n${i}`}
        transform={through(layerCamera(cam, node.parallax, W, H))}
      >
        {drawn}
      </g>
    ) : null;
  });
  const { style: titleStyle, transition } = graph.typography;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      style={{ position: "absolute", inset: 0, background: COLORS.background }}
    >
      <TypeDefs />
      <defs>
        {Object.entries(graph.materials).map(([name, m]) => (
          <MaterialDefs key={name} name={name} material={m} color={color} />
        ))}
        <radialGradient id="scnGlow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fff" stopOpacity="1" />
          <stop offset="0.35" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="scnVignette" cx="0.5" cy="0.5" r="0.72">
          <stop offset="0.6" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.5" />
        </radialGradient>
      </defs>
      <MaterialContext.Provider value={{ materials: graph.materials, color }}>
        {nodes}
      </MaterialContext.Provider>
      <rect width={W} height={H} fill="url(#scnVignette)" />
      <g opacity={0.9}>
        <circle
          cx={W / 2 - 166}
          cy={SAFE.top - 30}
          r={7}
          fill={COLORS.primary}
        />
        <text
          x={W / 2 + 10}
          y={SAFE.top - 20}
          textAnchor="middle"
          fontFamily={FONT}
          fontWeight={700}
          fontSize={26}
          letterSpacing={7}
          fill={COLORS.dim}
        >
          FRAMEBOP LAB
        </text>
      </g>
      {graph.headlines.map((h, i) => {
        const fit = headlineLayout(ctx, h, f);
        if (titleStyle !== "kinetic")
          return (
            <StyledTitle
              key={`h${i}`}
              layout={fit}
              style={titleStyle}
              transition={transition}
              frame={f}
              from={frameOf(ctx, h.from)}
              to={frameOf(ctx, h.to)}
              x={W / 2}
              y={HEADLINE_Y}
              punch={h.punch}
            />
          );
        return (
          <KineticTitle
            key={`h${i}`}
            text={fit.text}
            frame={f}
            from={frameOf(ctx, h.from)}
            to={frameOf(ctx, h.to)}
            x={W / 2}
            y={HEADLINE_Y}
            size={fit.size}
            maxWidth={HEADLINE_WIDTH}
            punch={h.punch}
          />
        );
      })}
    </svg>
  );
}

const MaterialContext = createContext<{
  materials: Record<string, SceneMaterial>;
  color: (token: string) => string;
}>({ materials: {}, color: (c) => c });

/** Line and path ends as far as `progress` draws them, from the start. */
function drawn(
  points: { x: number; y: number }[],
  progress: number,
): { x: number; y: number }[] {
  const p = Math.max(0, Math.min(1, progress));
  if (p >= 1) return points;
  const lengths = points
    .slice(1)
    .map((b, i) => Math.hypot(b.x - points[i]!.x, b.y - points[i]!.y));
  let left = lengths.reduce((a, b) => a + b, 0) * p;
  const out = [points[0]!];
  for (let i = 0; i < lengths.length; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (left >= lengths[i]!) {
      out.push(b);
      left -= lengths[i]!;
      continue;
    }
    const t = lengths[i]! > 0 ? left / lengths[i]! : 0;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    break;
  }
  return out;
}

function MaterialDefs({
  name,
  material,
  color,
}: {
  name: string;
  material: SceneMaterial;
  color: (t: string) => string;
}) {
  const g = material.gradient;
  return (
    <>
      {g?.kind === "linear" && (
        <linearGradient
          id={`m-${name}`}
          x1={g.from[0]}
          y1={g.from[1]}
          x2={g.to[0]}
          y2={g.to[1]}
        >
          {g.stops.map((s, i) => (
            <stop
              key={i}
              offset={s.offset}
              stopColor={color(s.color)}
              stopOpacity={s.opacity}
            />
          ))}
        </linearGradient>
      )}
      {g?.kind === "radial" && (
        <radialGradient id={`m-${name}`} cx="0.5" cy="0.5" r="0.5">
          {g.stops.map((s, i) => (
            <stop
              key={i}
              offset={s.offset}
              stopColor={color(s.color)}
              stopOpacity={s.opacity}
            />
          ))}
        </radialGradient>
      )}
      {material.glow > 0 && (
        <filter id={`g-${name}`} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation={material.glow} />
        </filter>
      )}
      {material.blur > 0 && (
        <filter id={`b-${name}`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation={material.blur} />
        </filter>
      )}
    </>
  );
}

/** Paint for a node: its material's fill and stroke, gradient and filter. */
function usePaint(name: string | undefined) {
  const { materials, color } = useContext(MaterialContext);
  const m = name ? materials[name] : undefined;
  return {
    fill: m?.gradient ? `url(#m-${name})` : m ? color(m.fill) : color("$text"),
    stroke: m ? color(m.stroke) : "none",
    glow: m && m.glow > 0 ? `url(#g-${name})` : undefined,
    blur: m && m.blur > 0 ? `url(#b-${name})` : undefined,
    flat: m ? color(m.fill === "none" ? m.stroke : m.fill) : color("$text"),
  };
}

function smoothPath(
  points: { x: number; y: number }[],
  closed: boolean,
): string {
  if (points.length < 3)
    return `M ${points.map((p) => `${p.x} ${p.y}`).join(" L ")}`;
  const at = (i: number) =>
    points[
      closed
        ? (i + points.length) % points.length
        : Math.max(0, Math.min(points.length - 1, i))
    ]!;
  let d = `M ${at(0).x} ${at(0).y}`;
  const n = closed ? points.length : points.length - 1;
  for (let i = 0; i < n; i += 1) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    d += ` C ${p1.x + (p2.x - p0.x) / 6} ${p1.y + (p2.y - p0.y) / 6}, ${p2.x - (p3.x - p1.x) / 6} ${p2.y - (p3.y - p1.y) / 6}, ${p2.x} ${p2.y}`;
  }
  return closed ? `${d} Z` : d;
}

function draw(
  node: SceneNode,
  ctx: SceneContext,
  f: number,
  words: Words,
  key: string,
): ReactNode {
  const shown = node.shown
    ? during(
        f,
        frameOf(ctx, node.shown.from),
        frameOf(ctx, node.shown.to),
        node.shown.fade,
      )
    : 1;
  const opacity = shown * trackAt(ctx, node.opacity, f);
  if (opacity <= 0.005) return null;
  return (
    <Node
      key={key}
      node={node}
      ctx={ctx}
      f={f}
      words={words}
      opacity={opacity}
      id={key}
    />
  );
}

function Node({
  node,
  ctx,
  f,
  words,
  opacity,
  id,
}: {
  node: SceneNode;
  ctx: SceneContext;
  f: number;
  words: Words;
  opacity: number;
  id: string;
}) {
  const paint = usePaint(node.material);
  const v = (t: Parameters<typeof trackAt>[1]) => trackAt(ctx, t, f);
  const glowed = (shape: ReactNode) => (
    <g opacity={opacity}>
      {paint.glow && <g filter={paint.glow}>{shape}</g>}
      <g filter={paint.blur}>{shape}</g>
    </g>
  );
  switch (node.type) {
    case "circle":
      return glowed(
        <circle
          cx={v(node.cx)}
          cy={v(node.cy)}
          r={Math.max(0, v(node.r))}
          fill={paint.fill}
          stroke={paint.stroke}
          strokeWidth={3}
        />,
      );
    case "rect": {
      const w = v(node.w);
      const h = v(node.h);
      return glowed(
        <rect
          x={Math.min(v(node.x), v(node.x) + w)}
          y={Math.min(v(node.y), v(node.y) + h)}
          width={Math.abs(w)}
          height={Math.abs(h)}
          rx={node.rx}
          fill={paint.fill}
          stroke={paint.stroke}
          strokeWidth={3}
        />,
      );
    }
    case "line": {
      const [a, b = a] = drawn(
        [
          { x: v(node.x1), y: v(node.y1) },
          { x: v(node.x2), y: v(node.y2) },
        ],
        v(node.progress),
      );
      if (v(node.progress) <= 0) return null;
      return glowed(
        <line
          x1={a!.x}
          y1={a!.y}
          x2={b!.x}
          y2={b!.y}
          stroke={paint.flat}
          strokeWidth={node.width}
          strokeLinecap="round"
          strokeDasharray={node.dash.length ? node.dash.join(" ") : undefined}
        />,
      );
    }
    case "arrow": {
      const x1 = v(node.x1);
      const y1 = v(node.y1);
      const x2 = v(node.x2);
      const y2 = v(node.y2);
      const head = (x: number, y: number, a: number) => {
        const h = node.head;
        return `${x},${y} ${x - Math.cos(a - 0.45) * h},${y - Math.sin(a - 0.45) * h} ${x - Math.cos(a + 0.45) * h},${y - Math.sin(a + 0.45) * h}`;
      };
      const a = Math.atan2(y2 - y1, x2 - x1);
      return glowed(
        <>
          <line
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={paint.flat}
            strokeWidth={node.width}
            strokeLinecap="round"
          />
          <polygon points={head(x2, y2, a)} fill={paint.flat} />
          {node.double && (
            <polygon points={head(x1, y1, a + Math.PI)} fill={paint.flat} />
          )}
        </>,
      );
    }
    case "polygon": {
      const pts = node.points.map((p) => ({ x: v(p.x), y: v(p.y) }));
      return glowed(
        node.smooth ? (
          <path
            d={smoothPath(pts, true)}
            fill={paint.fill}
            stroke={paint.stroke}
          />
        ) : (
          <polygon
            points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
            fill={paint.fill}
            stroke={paint.stroke}
          />
        ),
      );
    }
    case "path": {
      const pts = drawn(
        node.points.map((p) => ({ x: v(p.x), y: v(p.y) })),
        v(node.progress),
      );
      if (pts.length < 2) return null;
      return glowed(
        <path
          d={
            node.smooth
              ? smoothPath(pts, false)
              : `M ${pts.map((p) => `${p.x} ${p.y}`).join(" L ")}`
          }
          fill="none"
          stroke={paint.flat}
          strokeWidth={node.width}
          strokeLinecap="round"
        />,
      );
    }
    case "text":
      return (
        <text
          x={v(node.x)}
          y={v(node.y)}
          textAnchor={node.align}
          fontFamily={FONT}
          fontWeight={node.weight}
          fontSize={node.size}
          fill={paint.flat}
          opacity={opacity}
        >
          {fillText(ctx, node.text, f, words)}
        </text>
      );
    case "label":
      return (
        <Chip
          x={v(node.x)}
          y={v(node.y)}
          text={fillText(ctx, node.text, f, words)}
          color={paint.flat}
          size={node.size}
          filled={node.filled}
          opacity={opacity}
          rise={Math.min(1, opacity * 1.2)}
        />
      );
    case "glow": {
      const r = Math.max(0, v(node.r));
      return (
        <g opacity={opacity}>
          <circle
            cx={v(node.cx)}
            cy={v(node.cy)}
            r={r}
            fill="url(#scnGlow)"
            style={{ mixBlendMode: "screen" }}
          />
          <circle
            cx={v(node.cx)}
            cy={v(node.cy)}
            r={r}
            fill={paint.flat}
            opacity={0.35}
            filter="url(#cinemaSoft)"
            style={{ mixBlendMode: "screen" }}
          />
        </g>
      );
    }
    case "trail": {
      const dots: ReactNode[] = [];
      for (let k = node.step; k <= node.length; k += node.step) {
        if (f - k < 0) break;
        const fade = 1 - k / node.length;
        dots.push(
          <circle
            key={k}
            cx={trackAt(ctx, node.x, f - k)}
            cy={trackAt(ctx, node.y, f - k)}
            r={node.r * (0.4 + 0.6 * fade)}
            fill={paint.flat}
            opacity={0.55 * fade * opacity}
          />,
        );
      }
      return <g>{dots}</g>;
    }
    case "mascot":
    case "prop":
      // Through its material too, for a soft, out-of-focus prop.
      return glowed(<Figure node={node} ctx={ctx} f={f} id={id} />);
    case "silhouette": {
      const of = ctx.graph.nodes.find((n) => n.id === node.of);
      if (!of || (of.type !== "mascot" && of.type !== "prop")) return null;
      const clip = node.clipBottom ? v(node.clipBottom) : null;
      return (
        <g opacity={opacity}>
          <defs>
            <filter
              id={`${id}flat`}
              x="-20%"
              y="-20%"
              width="140%"
              height="140%"
            >
              <feFlood floodColor={node.color} />
              <feComposite in2="SourceAlpha" operator="in" />
              {node.blur > 0 && <feGaussianBlur stdDeviation={node.blur} />}
            </filter>
            {clip !== null && (
              <clipPath id={`${id}clip`}>
                <rect x={-4000} y={-4000} width={9000} height={clip + 4000} />
              </clipPath>
            )}
          </defs>
          <g clipPath={clip !== null ? `url(#${id}clip)` : undefined}>
            <g filter={`url(#${id}flat)`}>
              <Figure
                node={of}
                ctx={ctx}
                f={f}
                id={`${id}s`}
                at={{
                  x: v(node.x),
                  y: v(node.y),
                  size: v(node.size) * v(node.scale),
                }}
              />
            </g>
          </g>
        </g>
      );
    }
    case "room":
      return <Room node={node} ctx={ctx} f={f} opacity={opacity} />;
    case "lighting": {
      const preset = node.preset ?? "even";
      if (preset === "even") return null;
      const r =
        Math.max(1, v(node.radius)) * (1 + flickerAt(f) * 0.035 * node.flicker);
      const x = v(node.x);
      const y = v(node.y);
      const dark =
        preset === "moody"
          ? [
              [0, 0],
              [0.32, 0.4],
              [0.72, 0.82],
              [1, 0.94],
            ]
          : [
              [0, 0],
              [0.45, 0.22],
              [1, 0.7],
            ];
      return (
        <g opacity={opacity}>
          <defs>
            <radialGradient
              id={`${id}dark`}
              gradientUnits="userSpaceOnUse"
              cx={x}
              cy={y}
              r={r * 1.7}
            >
              {dark.map(([o, a]) => (
                <stop key={o} offset={o} stopColor="#000" stopOpacity={a} />
              ))}
            </radialGradient>
            <radialGradient
              id={`${id}pool`}
              gradientUnits="userSpaceOnUse"
              cx={x}
              cy={y}
              r={r}
            >
              <stop
                offset={0}
                stopColor={paint.flat}
                stopOpacity={preset === "moody" ? 0.26 : 0.14}
              />
              <stop offset={1} stopColor={paint.flat} stopOpacity={0} />
            </radialGradient>
          </defs>
          <rect
            x={-4000}
            y={-4000}
            width={9000}
            height={9000}
            fill={`url(#${id}dark)`}
          />
          <circle
            cx={x}
            cy={y}
            r={r}
            fill={`url(#${id}pool)`}
            style={{ mixBlendMode: "screen" }}
          />
        </g>
      );
    }
    case "group":
      return (
        <g
          opacity={opacity}
          transform={`translate(${v(node.x)} ${v(node.y)}) rotate(${v(node.rotation)}) scale(${v(node.scale)})`}
        >
          {node.children.map((child, i) =>
            draw(child, ctx, f, words, `${id}-${i}`),
          )}
        </g>
      );
  }
}

/**
 * A mascot or a prop, where it stands or (for its silhouette) at another
 * place and size: everything else, its walk and its look, is its own.
 */
function Figure({
  node,
  ctx,
  f,
  id,
  at,
}: {
  node: Extract<SceneNode, { type: "mascot" | "prop" }>;
  ctx: SceneContext;
  f: number;
  id: string;
  at?: { x: number; y: number; size: number };
}) {
  const v = (t: Parameters<typeof trackAt>[1]) => trackAt(ctx, t, f);
  const x = at?.x ?? v(node.x);
  const y = at?.y ?? v(node.y);
  const size = at?.size ?? v(node.size) * v(node.scale);
  if (node.type === "prop")
    return (
      <Prop
        kind={node.kind}
        x={x}
        y={y}
        size={size}
        flicker={node.flicker}
        frame={f}
        id={id}
      />
    );
  // A bob for each step walked: it walks as it moves, and stands when not.
  const step = v(node.step);
  const bob = Math.abs(Math.sin(Math.PI * step)) * 0.05 * size;
  return (
    <Mascot
      id={`${id}m`}
      x={x}
      y={y - bob}
      size={size}
      look={node.look ? v(node.look) : Math.sin(f / 40)}
      blink={f % 150 < 6 ? 1 - Math.abs((f % 150) - 3) / 3 : 0}
      hop={0}
      sway={Math.sin(f / 12) * 6 + Math.sin(Math.PI * step) * 8}
      ground={node.ground && !at}
    />
  );
}

/** A back wall and a floor whose boards run to the vanishing point. */
function Room({
  node,
  ctx,
  f,
  opacity,
}: {
  node: Extract<SceneNode, { type: "room" }>;
  ctx: SceneContext;
  f: number;
  opacity: number;
}) {
  const wallPaint = usePaint(node.wallMaterial);
  const floorPaint = usePaint(node.floorMaterial);
  const v = (t: Parameters<typeof trackAt>[1]) => trackAt(ctx, t, f);
  const vx = v(node.vanish.x);
  const vy = v(node.vanish.y);
  const left = v(node.wall.left);
  const top = v(node.wall.top);
  const right = v(node.wall.right);
  const bottom = v(node.wall.bottom);
  const far = ctx.graph.height + 600;
  // Along the line from the vanishing point through a wall-foot point.
  const out = (x: number) => vx + ((x - vx) * (far - vy)) / (bottom - vy);
  const spacing = Math.max(8, v(node.boards));
  const boards: number[] = [];
  for (
    let k = Math.floor((left - vx) / spacing);
    k <= Math.ceil((right - vx) / spacing);
    k += 1
  )
    boards.push(vx + k * spacing);
  return (
    <g opacity={opacity}>
      <rect
        x={left}
        y={top}
        width={right - left}
        height={bottom - top}
        fill={wallPaint.fill}
      />
      <polygon
        points={`${left},${bottom} ${right},${bottom} ${out(right)},${far} ${out(left)},${far}`}
        fill={floorPaint.fill}
      />
      {boards.map((x) => (
        <line
          key={x}
          x1={x}
          y1={bottom}
          x2={out(x)}
          y2={far}
          stroke="#000"
          strokeOpacity={0.32}
          strokeWidth={2.5}
        />
      ))}
      <rect
        x={left}
        y={bottom - spacing * 0.14}
        width={right - left}
        height={spacing * 0.14}
        fill="#000"
        opacity={0.35}
      />
    </g>
  );
}
