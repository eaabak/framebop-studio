/**
 * Which Path Wins? Two identical spheres are let go together and slide
 * without friction from the same start to the same finish: one down the
 * straight ramp, one down the cycloid. The set is drawn in 3D on the cinema
 * stage; the words and scores are drawn over it. Both follow the direction,
 * which reads every position, speed and time from the simulation.
 */
import type { BrachistochroneLab } from "@framebop/core";
import { type ReactNode, useCallback } from "react";
import type { Hold } from "../animation/PixiScene";
import { EASE, clamp, lerp } from "../animation/timing";
import { Mascot } from "../cinema/mascot";
import { COLORS, FONT, SAFE } from "../cinema/palette";
import { project } from "../cinema/lens";
import {
  Callout,
  Chip,
  KineticTitle,
  TypeDefs,
  during,
  ramp,
} from "../cinema/type";
import { WebGLScene, useFontsReady } from "../cinema/WebGLScene";
import { labPhrases, phrase } from "./phrases";
import { stateAt } from "./physics";
import {
  type Direction,
  MARK_STEP,
  RADIUS,
  direct,
  momentAt,
} from "./brachistochrone/director";
import { BrachistochroneWorld } from "./brachistochrone/world";
import {
  RACE_PINS,
  RACE_TYPE,
  cardLabelSize,
  headlineAt,
  raceCards,
  underHeadline,
} from "./brachistochrone/layout";
import { headlineBox, overlap } from "../cinema/layout";

export function BrachistochroneScene({
  lab,
  frame,
  fps,
  width,
  height,
  duration,
  pixels,
  hold,
}: {
  lab: BrachistochroneLab;
  /** The spec's frame, fractional when the output rate differs. */
  frame: number;
  fps: number;
  width: number;
  height: number;
  duration: number;
  /** Size of the drawing surface in pixels. */
  pixels: { width: number; height: number };
  hold?: () => Hold;
}) {
  const d = direct(lab, fps, duration, { width, height });
  const ready = useFontsReady(`850 100px ${FONT}`);
  const create = useCallback(
    () => new BrachistochroneWorld(d, pixels.width, pixels.height),
    [d, pixels.width, pixels.height],
  );
  return (
    <>
      <WebGLScene create={create} frame={frame} hold={hold} ready={ready} />
      <Overlay d={d} f={frame} width={width} height={height} />
    </>
  );
}

function Overlay({
  d,
  f,
  width,
  height,
}: {
  d: Direction;
  f: number;
  width: number;
  height: number;
}) {
  const { lab, winner, arrivals, faster } = d;
  const LANE_COLORS = laneColors(lab);
  const words = labPhrases(lab.language);
  const { beats, text } = lab;
  const loser = 1 - winner;
  const m = momentAt(d, f);
  const at = (p: { x: number; y: number; z: number }) =>
    project(m.pose, width, height, p, m.shake);
  const cx = width / 2;
  const accents: Record<string, string> = {
    [key(text.contenders[0])]: LANE_COLORS[0],
    [key(text.contenders[1])]: LANE_COLORS[1],
  };
  const items: ReactNode[] = [];
  const titleY = RACE_TYPE.titleY;
  const maxWidth = RACE_TYPE.maxWidth;

  // ------------------------------------------------------------ headlines
  const go = lab.releaseFrame;
  items.push(
    <KineticTitle
      key="hook"
      text={text.hook}
      frame={f}
      from={1}
      to={go + 30}
      x={cx}
      y={titleY}
      size={RACE_TYPE.hook}
      maxWidth={maxWidth}
      accents={accents}
      punch={0.4}
    />,
    <KineticTitle
      key="reveal"
      text={phrase(words.wins, { name: text.contenders[winner]! })}
      frame={f}
      from={beats.reveal}
      to={beats.explanation}
      x={cx}
      y={titleY + 10}
      size={RACE_TYPE.reveal}
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
      size={RACE_TYPE.why}
      maxWidth={maxWidth}
      accents={accents}
    />,
    <KineticTitle
      key="closing"
      text={text.closing}
      frame={f}
      from={beats.closing + 4}
      to={d.duration - 6}
      x={cx}
      y={titleY}
      size={RACE_TYPE.closing}
      maxWidth={maxWidth}
      accents={accents}
      punch={0.4}
    />,
  );

  // Which track is which, pinned to them while the race starts.
  const named = during(f, 6, go + 44, 8);
  // During the explanation, what each start is like.
  const shaped = during(f, d.replay.from - 6, beats.closing + 2, 8);
  [0, 1].forEach((i) => {
    const lane = d.lanes[i]!;
    const pin = (u: number) =>
      at(lane.centers[Math.round(u * (lane.centers.length - 1))]!);
    const p = pin(RACE_PINS.name[i]!);
    items.push(
      <Callout
        key={`name${i}`}
        x={p.x}
        y={p.y}
        text={text.contenders[i]!}
        color={LANE_COLORS[i]!}
        opacity={named}
        side={i === 0 ? 1 : -1}
      />,
    );
    const q = pin(RACE_PINS.shape[i]!);
    items.push(
      <Callout
        key={`shape${i}`}
        x={q.x}
        y={q.y}
        text={i === 1 ? words.steep : words.gentle}
        color={LANE_COLORS[i]!}
        opacity={shaped}
        side={i === 0 ? 1 : -1}
        offset={i === 1 ? RACE_PINS.shapeOffset : undefined}
      />,
    );
  });

  // ------------------------------------------------------- small labels
  // The conditions, once the title has gone; the replay said as such.
  const conditions = during(f, go + 28, beats.reveal, 8);
  items.push(
    <Chip
      key="friction"
      x={cx - 170}
      y={titleY - 60}
      text={words.noFriction}
      color={COLORS.dim}
      opacity={conditions}
      rise={conditions}
      size={30}
    />,
    <Chip
      key="slow"
      x={cx + 170}
      y={titleY - 60}
      text={phrase(words.slowMotion, { n: lab.slowMotion })}
      color={COLORS.primary}
      opacity={conditions}
      rise={conditions}
      size={30}
    />,
  );
  const replaying = during(f, d.replay.from - 6, beats.closing + 2, 8);
  items.push(
    <Chip
      key="replay"
      x={cx}
      y={underHeadline(text.explanation, RACE_TYPE.why, titleY, width)}
      text={phrase(words.replay, { n: MARK_STEP })}
      color={COLORS.text}
      opacity={replaying}
      rise={replaying}
      size={28}
    />,
  );
  if (f >= beats.reveal + 8 && f < beats.explanation) {
    const shown = during(f, beats.reveal + 10, beats.explanation, 8);
    items.push(
      <Chip
        key="faster"
        x={cx}
        y={underHeadline(
          phrase(words.wins, { name: text.contenders[winner]! }),
          RACE_TYPE.reveal,
          titleY + 10,
          width,
        )}
        text={phrase(words.lessTime, { n: faster })}
        color={LANE_COLORS[winner]!}
        filled
        opacity={shown}
        rise={ramp(f, beats.reveal + 10, beats.reveal + 22, EASE.outBack)}
        size={42}
      />,
    );
  }

  // ------------------------------------------------------------- scores
  const cards = during(f, lab.releaseFrame - 10, beats.closing + 16, 10);
  if (cards > 0) {
    // In the explanation the cards show each sphere's speed in the replay.
    const replayTime =
      f < d.replay.from ? 0 : f < d.replay.to ? m.time : d.replay.end;
    const top = Math.sqrt(2 * lab.gravity * lab.drop);
    const speedMode = ramp(f, beats.explanation + 6, beats.explanation + 16);
    [0, 1].forEach((i) => {
      const x = raceCards(width)[i]!.x;
      const y = raceCards(width)[i]!.y;
      const traj = d.lanes[i]!.trajectory;
      // Race clock while racing; final times from the replay on.
      const elapsed =
        f < beats.explanation ? Math.min(m.time, traj.arrival) : traj.arrival;
      const won =
        i === winner ? during(f, beats.reveal + 6, beats.explanation, 10) : 0;
      const lost =
        i === loser ? during(f, beats.reveal + 6, beats.explanation, 10) : 0;
      const arrivedNow =
        f >= arrivals[i]! && f < beats.explanation
          ? Math.exp(-(f - arrivals[i]!) / 8)
          : 0;
      const speed = stateAt(traj, replayTime).speed;
      const w = 420;
      const h = 150;
      const slide =
        (1 -
          ramp(f, lab.releaseFrame - 6, lab.releaseFrame + 8, EASE.outBack)) *
        80;
      items.push(
        <g
          key={`card${i}`}
          opacity={cards * lerp(1, 0.5, lost)}
          transform={`translate(0 ${slide}) translate(${x} ${y}) scale(${1 + won * 0.08 + arrivedNow * 0.05}) translate(${-x} ${-y})`}
        >
          <rect
            x={x - w / 2}
            y={y - h / 2}
            width={w}
            height={h}
            rx={30}
            fill={COLORS.panel}
            fillOpacity={0.88}
            stroke={LANE_COLORS[i]}
            strokeOpacity={0.35 + 0.65 * Math.max(won, arrivedNow)}
            strokeWidth={won > 0 ? 5 : 2.5}
          />
          <circle
            cx={x - w / 2 + 40}
            cy={y - 38}
            r={10}
            fill={LANE_COLORS[i]}
          />
          <text
            x={x - w / 2 + 64}
            y={y - 27}
            fontFamily={FONT}
            fontWeight={800}
            fontSize={cardLabelSize(text.contenders[i]!)}
            letterSpacing={3}
            fill={COLORS.text}
          >
            {text.contenders[i]}
          </text>
          {f >= arrivals[i]! && (
            // The place, stamped on as each sphere crosses the line.
            <g
              opacity={clamp((f - arrivals[i]!) / 3)}
              transform={`translate(${x + w / 2 - 75} ${y - 38}) scale(${lerp(1.6, 1, EASE.outBack(clamp((f - arrivals[i]!) / 8)))}) translate(${-(x + w / 2 - 75)} ${-(y - 38)})`}
            >
              <rect
                x={x + w / 2 - 122}
                y={y - 60}
                width={94}
                height={42}
                rx={21}
                fill={i === winner ? LANE_COLORS[i] : COLORS.panel}
                stroke={LANE_COLORS[i]}
                strokeWidth={i === winner ? 0 : 2}
              />
              <text
                x={x + w / 2 - 75}
                y={y - 30}
                textAnchor="middle"
                fontFamily={FONT}
                fontWeight={900}
                fontSize={26}
                letterSpacing={2}
                fill={i === winner ? COLORS.background : COLORS.text}
              >
                {i === winner ? words.first : words.second}
              </text>
            </g>
          )}
          <text
            x={x - w / 2 + 38}
            y={y + 56}
            fontFamily={FONT}
            fontWeight={850}
            fontSize={72}
            fill={COLORS.text}
            opacity={1 - speedMode}
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {elapsed.toFixed(2)}
            <tspan fontSize={36} fill={COLORS.dim} dx={8}>
              s
            </tspan>
          </text>
          <g opacity={speedMode}>
            <text
              x={x - w / 2 + 38}
              y={y + 8}
              fontFamily={FONT}
              fontWeight={700}
              fontSize={24}
              letterSpacing={3}
              fill={COLORS.dim}
            >
              {words.speed}
            </text>
            <rect
              x={x - w / 2 + 38}
              y={y + 22}
              width={w - 76}
              height={26}
              rx={13}
              fill="#232a38"
            />
            <rect
              x={x - w / 2 + 38}
              y={y + 22}
              width={Math.max(26, (w - 76) * (speed / top))}
              height={26}
              rx={13}
              fill={LANE_COLORS[i]}
            />
          </g>
        </g>,
      );
    });
  }

  // -------------------------------------------------------------- mascot
  {
    // It watches from the top of the start tower, and stands on the finish
    // block for the result, fading from one place to the other.
    const atFinish = during(f, beats.reveal + 4, beats.explanation + 4, 12);
    const anchors = [
      {
        id: "labMascotTower",
        world: {
          x: -lab.span / 2 - RADIUS - 0.12,
          y: lab.drop / 2 + RADIUS + 0.08,
          z: 0.18,
        },
        height: 0.3,
        weight: 1 - atFinish,
      },
      {
        id: "labMascotFinish",
        world: {
          x: lab.span / 2 + 0.38,
          y: -lab.drop / 2 - RADIUS - 0.005,
          z: -0.34,
        },
        height: 0.26,
        weight: atFinish,
      },
    ];
    const lead = at(m.centers[winner]);
    const hop =
      Math.max(0, Math.sin(clamp((f - arrivals[winner]) / 14) * Math.PI)) +
      Math.max(0, Math.sin(clamp((f - beats.reveal - 3) / 16) * Math.PI)) * 1.2;
    const blink = [20, 120, 200, 300, 420, 500].reduce((b, t) => {
      const age = f - t;
      return age >= 0 && age < 8 ? Math.max(b, 1 - Math.abs(age - 3) / 4) : b;
    }, 0);
    for (const anchor of anchors) {
      if (anchor.weight <= 0.01) continue;
      const spot = at(anchor.world);
      const size = clamp(anchor.height * spot.scale, 70, 190);
      // Hidden whenever it would stand behind the score cards.
      const clear = cards <= 0.01 || spot.y < SAFE.bottom - 210;
      // The mascot is drawn over the picture, so it steps aside (fades)
      // whenever it would cover either sphere.
      const covers = Math.max(
        ...m.centers.map((c) => {
          const p = at(c);
          const dx = Math.abs(p.x - spot.x) / (size * 0.75);
          const dy = Math.abs(p.y - (spot.y - size * 0.5)) / (size * 0.75);
          return clamp(1.6 - Math.max(dx, dy));
        }),
      );
      // Nor does it stand on the headline showing at this frame.
      const shown = headlineAt(
        f,
        lab,
        phrase(words.wins, { name: text.contenders[winner]! }),
        d.duration,
      );
      if (shown) {
        const box = headlineBox(
          shown.text,
          shown.size,
          cx,
          shown.y,
          RACE_TYPE.maxWidth,
        ).rect;
        const me = {
          left: spot.x - size / 2,
          top: spot.y - size,
          right: spot.x + size / 2,
          bottom: spot.y,
        };
        if (overlap(box, me) > 0) continue;
      }
      if (
        !clear ||
        covers >= 0.99 ||
        spot.depth <= 0.2 ||
        // Only when it fits in the picture whole.
        spot.x - size / 2 <= 12 ||
        spot.x + size / 2 >= width - 12
      ) {
        continue;
      }
      items.push(
        <g key={anchor.id} opacity={anchor.weight * (1 - covers)}>
          <Mascot
            id={anchor.id}
            x={spot.x}
            y={spot.y}
            size={size}
            look={(lead.x - spot.x) / 300}
            blink={blink}
            hop={hop}
            sway={Math.sin(f / 12) * 6 + hop * 18}
          />
        </g>,
      );
    }
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      style={{ position: "absolute", inset: 0 }}
    >
      <TypeDefs />
      <defs>
        <radialGradient id="labVignette" cx="0.5" cy="0.5" r="0.72">
          <stop offset="0.6" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.5" />
        </radialGradient>
        <linearGradient id="labTop" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={COLORS.background} stopOpacity="0.85" />
          <stop offset="1" stopColor={COLORS.background} stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width={width} height={height} fill="url(#labVignette)" />
      {/* A soft dark band under the headlines keeps them readable. */}
      <rect width={width} height={SAFE.top + 420} fill="url(#labTop)" />
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
      {items}
    </svg>
  );
}

/** The straight lane's colour, then the curve's. */
export function laneColors(lab: BrachistochroneLab): readonly [string, string] {
  return [lab.style.secondary, lab.style.primary];
}

function key(word: string) {
  return word.replace(/[^\p{L}]/gu, "").toUpperCase();
}
