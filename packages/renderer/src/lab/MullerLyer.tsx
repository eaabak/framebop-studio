/**
 * The Müller-Lyer illusion as a short: two figures whose shafts are equal,
 * one with outward fins, one with inward fins. The story: which looks
 * longer, a measurement with guides dropped from the ends, the fins taken
 * away and the shafts laid on each other, then why: the eye takes in the
 * whole shape, fins included. Drawn in SVG with the cinema kit; every
 * length comes from `mullerFigures`, so the shafts are never changed.
 */
import type { MullerLyerLab } from "@framebop/core";
import type { ReactNode } from "react";
import { EASE, clamp, lerp } from "../animation/timing";
import { Mascot } from "../cinema/mascot";
import { COLORS, FONT, SAFE, mix } from "../cinema/palette";
import { Chip, KineticTitle, TypeDefs, during, ramp } from "../cinema/type";
import type { Hold } from "../animation/PixiScene";
import { useFontsReady, useHold } from "../cinema/WebGLScene";
import {
  type Figure,
  ILLUSION_TYPE as SIZE,
  type Point,
  labelYs,
  mullerFigures,
} from "./muller/geometry";
import { labPhrases } from "./phrases";

export function MullerLyerScene({
  lab,
  frame: f,
  width,
  height,
  duration,
  hold,
}: {
  lab: MullerLyerLab;
  frame: number;
  width: number;
  height: number;
  duration: number;
  hold?: () => Hold;
}) {
  useHold(hold, useFontsReady(`850 100px ${FONT}`));
  const { beats, text, style } = lab;
  const words = labPhrases(lab.language);
  const cx = width / 2;
  const titleY = SAFE.top + 150;
  const maxWidth = SAFE.right - SAFE.left - 40;
  const colors = [style.primary, style.secondary] as const;
  const accents: Record<string, string> = {
    [key(text.contenders[0])]: colors[0],
    [key(text.contenders[1])]: colors[1],
  };

  // The fins breathe a little, on a cycle that fits the video exactly.
  const flex = Math.sin((2 * Math.PI * f) / duration) * 2;
  const { top, bottom, length } = mullerFigures(lab, width, height, flex);
  const figures = [top, bottom] as const;
  const labelY = labelYs(top, bottom);

  // ------------------------------------------------------------ timing
  const measuring = during(f, beats.experiment, beats.reveal + 4, 8);
  const drop = ramp(
    f,
    beats.experiment + 6,
    beats.experiment + 30,
    EASE.inOutCubic,
  );
  const finsAway = during(f, beats.reveal, beats.explanation + 6, 12);
  const stack = during(f, beats.reveal + 10, beats.explanation, 14);
  const boxes = during(f, beats.explanation + 10, beats.closing + 6, 10);
  const matched =
    f >= beats.reveal + 24 ? Math.exp(-(f - beats.reveal - 24) / 8) : 0;
  const labels = during(f, -20, duration - 6, 10);
  const sweep = ramp(
    f,
    beats.prediction,
    beats.prediction + 26,
    EASE.inOutSine,
  );

  // The gentle camera: a slow breath of scale and drift, looping exactly,
  // and a small push while the shafts are compared.
  const zoom =
    lab.camera === "still"
      ? 1
      : 1 +
        (0.025 * (1 - Math.cos((2 * Math.PI * f) / duration))) / 2 +
        0.04 * stack;
  const drift =
    lab.camera === "still" ? 0 : Math.sin((2 * Math.PI * f) / duration) * 8;
  const cy = height * 0.58;

  // Where the lower shaft is drawn while it is laid on the upper one.
  const lift = (top.from.y - bottom.from.y) * EASE.inOutCubic(stack);

  const scene: ReactNode[] = [];
  figures.forEach((figure, i) => {
    const color = colors[i]!;
    const dy = i === 1 ? lift : 0;
    const shift = (p: Point) => ({ x: p.x, y: p.y + dy });
    const a = shift(figure.from);
    const b = shift(figure.to);
    const finOpacity = 1 - finsAway * 0.9;
    const pulse =
      sweep > 0 && sweep < 1
        ? Math.exp(-(((sweep - (i === 0 ? 0.35 : 0.65)) / 0.18) ** 2))
        : 0;
    // A soft light travels along the shaft all the time, so a held
    // moment is never a frozen picture; it changes no length.
    const glint = ((f / 48 + i * 0.5) % 1) * 1.4 - 0.2;
    const gx = a.x + (b.x - a.x) * glint;
    scene.push(
      <g key={`fig${i}`}>
        {/* Glow, then the shaft and the fins on top. */}
        <line
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          stroke={color}
          strokeWidth={46}
          strokeLinecap="round"
          opacity={0.28 + 0.4 * pulse + 0.5 * matched}
          filter="url(#cinemaSoft)"
        />
        {figure.fins.map(([p, q], k) => {
          const s = shift(p);
          const t = shift(q);
          return (
            <line
              key={k}
              x1={s.x}
              y1={s.y}
              x2={t.x}
              y2={t.y}
              stroke={mix(color, "#ffffff", 0.25)}
              strokeWidth={20}
              strokeLinecap="round"
              opacity={finOpacity}
            />
          );
        })}
        <line
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          stroke={color}
          strokeWidth={i === 1 ? lerp(24, 12, stack) : 24}
          strokeLinecap="round"
        />
        <line
          x1={a.x}
          y1={a.y - 3}
          x2={b.x}
          y2={b.y - 3}
          stroke="#ffffff"
          strokeOpacity={0.35}
          strokeWidth={3}
          strokeLinecap="round"
        />
        {glint > 0 && glint < 1 && (
          <line
            x1={Math.max(a.x, gx - 60)}
            y1={a.y}
            x2={Math.min(b.x, gx + 60)}
            y2={b.y}
            stroke="#ffffff"
            strokeOpacity={0.45}
            strokeWidth={14}
            strokeLinecap="round"
            filter="url(#cinemaSoft)"
          />
        )}
      </g>,
    );
  });

  // The measurement: guides dropped from the upper shaft's ends, through the
  // lower shaft's ends, with a dot where each meets an end.
  if (measuring > 0) {
    const reach = lerp(top.from.y, bottom.from.y + 60, drop);
    for (const x of [top.from.x, top.to.x]) {
      scene.push(
        <line
          key={`guide${x}`}
          x1={x}
          y1={top.from.y - 60}
          x2={x}
          y2={reach}
          stroke={COLORS.text}
          strokeOpacity={0.75 * measuring}
          strokeWidth={3}
          strokeDasharray="10 10"
        />,
      );
      for (const figure of figures) {
        const hit = figure === top ? 1 : clamp((reach - figure.from.y) / 20);
        scene.push(
          <circle
            key={`dot${x}${figure.from.y}`}
            cx={x}
            cy={figure.from.y}
            r={11}
            fill={COLORS.text}
            opacity={measuring * hit}
          />,
        );
      }
    }
    // A ruler under each shaft, with the same marks.
    figures.forEach((figure, i) => {
      const shown = ramp(
        f,
        beats.experiment + 18 + i * 8,
        beats.experiment + 40 + i * 8,
        EASE.outCubic,
      );
      const y = figure.from.y + 44;
      const ticks: ReactNode[] = [];
      for (let k = 0; k <= 10; k += 1) {
        const x = figure.from.x + (length * k) / 10;
        if (k / 10 > shown) break;
        ticks.push(
          <line
            key={k}
            x1={x}
            y1={y - (k % 5 === 0 ? 16 : 9)}
            x2={x}
            y2={y}
            stroke={COLORS.text}
            strokeOpacity={0.7}
            strokeWidth={3}
          />,
        );
      }
      scene.push(
        <g key={`ruler${i}`} opacity={measuring}>
          <line
            x1={figure.from.x}
            y1={y}
            x2={figure.from.x + length * shown}
            y2={y}
            stroke={COLORS.text}
            strokeOpacity={0.7}
            strokeWidth={3}
          />
          {ticks}
        </g>,
      );
    });
  }

  // The why: the whole shape, fins and all, boxed for each figure.
  if (boxes > 0) {
    figures.forEach((figure, i) => {
      const pad = 26;
      const finTop = Math.min(...figure.fins.map(([, q]) => q.y));
      const finBottom = Math.max(...figure.fins.map(([, q]) => q.y));
      const draw = ramp(
        f,
        beats.explanation + 10 + i * 10,
        beats.explanation + 34 + i * 10,
        EASE.outCubic,
      );
      const w = figure.extent.right - figure.extent.left + pad * 2;
      const h = finBottom - finTop + pad * 2;
      scene.push(
        <rect
          key={`box${i}`}
          x={figure.extent.left - pad}
          y={finTop - pad}
          width={w}
          height={h}
          rx={18}
          fill="none"
          stroke={colors[i]}
          strokeWidth={4}
          strokeDasharray={`${(w + h) * 2 * draw} 9999`}
          opacity={boxes}
        />,
      );
    });
  }

  // ------------------------------------------------------------ words
  const overlay: ReactNode[] = [];
  overlay.push(
    <KineticTitle
      key="hook"
      text={text.hook}
      frame={f}
      from={1}
      to={beats.prediction + 2}
      x={cx}
      y={titleY}
      size={SIZE.hook}
      maxWidth={maxWidth}
      accents={accents}
      punch={0.4}
    />,
    <KineticTitle
      key="prediction"
      text={text.prediction}
      frame={f}
      from={beats.prediction + 2}
      to={beats.experiment + 2}
      x={cx}
      y={titleY}
      size={SIZE.prediction}
      maxWidth={maxWidth}
      accents={accents}
    />,
    <KineticTitle
      key="same"
      text={words.sameLength}
      frame={f}
      from={beats.reveal + 22}
      to={beats.explanation}
      x={cx}
      y={titleY}
      size={SIZE.same}
      maxWidth={maxWidth}
      accents={accents}
      punch={1}
    />,
    <KineticTitle
      key="why"
      text={text.explanation}
      frame={f}
      from={beats.explanation + 4}
      to={beats.closing + 2}
      x={cx}
      y={titleY}
      size={SIZE.why}
      maxWidth={maxWidth}
      accents={accents}
    />,
    <KineticTitle
      key="closing"
      text={text.closing}
      frame={f}
      from={beats.closing + 4}
      to={duration - 6}
      x={cx}
      y={titleY}
      size={SIZE.closing}
      maxWidth={maxWidth}
      accents={accents}
      punch={0.4}
    />,
  );
  overlay.push(
    <Chip
      key="measure"
      x={cx}
      y={titleY - 60}
      text={words.measure}
      color={COLORS.text}
      opacity={during(f, beats.experiment + 2, beats.reveal, 8)}
      rise={measuring}
      size={SIZE.chip}
    />,
  );
  // Labels beside each figure, which step aside while the shafts are stacked.
  figures.forEach((figure, i) => {
    const shown = labels * (1 - stack);
    overlay.push(
      <Chip
        key={`label${i}`}
        x={cx}
        y={labelY[i]!}
        text={text.contenders[i]!}
        color={colors[i]!}
        opacity={shown}
        rise={shown}
        size={SIZE.label}
      />,
    );
  });
  overlay.push(
    <Chip
      key="whole"
      x={cx}
      y={labelY[1] + 64}
      text={words.wholeShape}
      color={COLORS.text}
      opacity={boxes}
      rise={boxes}
      size={SIZE.chip}
    />,
  );

  // The mascot watches from the lower left and hops at the reveal.
  const hop = Math.max(
    0,
    Math.sin(clamp((f - beats.reveal - 24) / 16) * Math.PI),
  );
  const blink = [24, 130, 260, 380].reduce((v, t) => {
    const age = f - t;
    return age >= 0 && age < 8 ? Math.max(v, 1 - Math.abs(age - 3) / 4) : v;
  }, 0);
  const watched = finsAway > 0.5 ? bottom : f < beats.experiment ? top : bottom;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      style={{ position: "absolute", inset: 0, background: COLORS.background }}
    >
      <TypeDefs />
      <defs>
        <radialGradient id="mlSpot" cx="0.5" cy="0.52" r="0.6">
          <stop offset="0" stopColor="#1d2434" />
          <stop offset="0.6" stopColor="#11151f" />
          <stop offset="1" stopColor={COLORS.background} />
        </radialGradient>
        <radialGradient id="mlVignette" cx="0.5" cy="0.5" r="0.72">
          <stop offset="0.6" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.5" />
        </radialGradient>
      </defs>
      <rect width={width} height={height} fill="url(#mlSpot)" />
      <Floor
        width={width}
        height={height}
        f={f}
        duration={duration}
        still={lab.camera === "still"}
      />
      <g
        transform={`translate(${cx + drift} ${cy}) scale(${zoom}) translate(${-cx} ${-cy})`}
      >
        {scene}
      </g>
      <rect width={width} height={height} fill="url(#mlVignette)" />
      <g opacity={0.9}>
        <circle cx={cx - 166} cy={SAFE.top - 30} r={7} fill={COLORS.primary} />
        <text
          x={cx + 10}
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
      {overlay}
      <Mascot
        id="mlMascot"
        x={SAFE.left + 90}
        y={SAFE.bottom - 40}
        size={SIZE.mascot}
        look={(watched.from.x + watched.to.x) / 2 > SAFE.left + 90 ? 0.8 : -0.8}
        blink={blink}
        hop={hop}
        sway={Math.sin(f / 12) * 6 + hop * 18}
      />
    </svg>
  );
}

/** A faint perspective floor under the figures, for depth. */
function Floor({
  width,
  height,
  f,
  duration,
  still,
}: {
  width: number;
  height: number;
  f: number;
  duration: number;
  still: boolean;
}) {
  const horizon = height * 0.66;
  const vx =
    width / 2 + (still ? 0 : Math.sin((2 * Math.PI * f) / duration) * 30);
  const lines: ReactNode[] = [];
  for (let k = -10; k <= 10; k += 1) {
    lines.push(
      <line
        key={`r${k}`}
        x1={vx}
        y1={horizon}
        x2={width / 2 + k * 260}
        y2={height}
        stroke="#8FA3C7"
        strokeOpacity={0.07}
        strokeWidth={2}
      />,
    );
  }
  for (let k = 1; k <= 8; k += 1) {
    const y = horizon + (height - horizon) * (k / 8) ** 1.8;
    lines.push(
      <line
        key={`h${k}`}
        x1={0}
        y1={y}
        x2={width}
        y2={y}
        stroke="#8FA3C7"
        strokeOpacity={0.05 + 0.03 * (k / 8)}
        strokeWidth={2}
      />,
    );
  }
  return <g>{lines}</g>;
}

function key(word: string) {
  return word.replace(/[^\p{L}]/gu, "").toUpperCase();
}

export type { Figure };
