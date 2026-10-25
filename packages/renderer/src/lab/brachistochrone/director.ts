/**
 * The direction of Which Path Wins?: what every frame shows, decided from
 * the frame number and the simulation alone. The 3D world, the overlay and
 * the sound all read it, so picture and sound always agree.
 *
 * Clarity first: one hero composition shows both whole tracks for the
 * race; the camera only eases closer to the finish for the result, and
 * back for the explanation, where the same race is replayed (and labelled
 * so) with both spheres marked at the same moments.
 */
import type { BrachistochroneLab } from "@framebop/core";
import { EASE, clamp } from "../../animation/timing";
import {
  type CameraKey,
  type CameraPose,
  type Shake,
  type Vec3,
  poseAt,
  shakeAt,
  vec,
} from "../../cinema/camera";
import { type ScreenBox, fitShot } from "../../cinema/lens";
import { type TimeSegment, remapTime } from "../../cinema/remap";
import {
  type BrachistochroneRun,
  arrivalFrame,
  brachistochroneRun,
} from "../experiments";
import { type SlideState, type Trajectory, stateAt } from "../physics";

/** Sphere radius, in metres. */
export const RADIUS = 0.075;
/** Depth of each lane: the straight one behind, the curve in front. */
export const LANE_Z = [-0.24, 0.24] as const;
export const SEGMENTS = 160;
/** The explanation marks both spheres every MARK_STEP simulated seconds. */
export const MARK_STEP = 0.1;
export const SNAPSHOTS = 9;

export interface Lane {
  trajectory: Trajectory;
  z: number;
  /** Sphere centres along the lane, and the side the sphere rides on. */
  centers: Vec3[];
  normals: Vec3[];
}

export interface Direction {
  lab: BrachistochroneLab;
  fps: number;
  duration: number;
  /** The picture the shots are composed for. */
  width: number;
  height: number;
  run: BrachistochroneRun;
  lanes: [Lane, Lane];
  floorY: number;
  /** Fractional frames of each arrival, in the race. */
  arrivals: [number, number];
  winner: 0 | 1;
  /** Percent less time the winner took. */
  faster: number;
  /** The explanation's replay, in frames and simulated seconds. */
  replay: { from: number; to: number; start: number; end: number };
  /** The edit: which simulated moment each frame shows. */
  cut: TimeSegment[];
  /** Frames where the spheres jump back to the start, unseen. */
  jumps: number[];
  keys: CameraKey[];
  shakes: Shake[];
  landmarks: {
    finish: Vec3;
    set: Vec3[];
    lanes: Vec3[];
    /** The second half of both lanes and the finish block. */
    half: Vec3[];
    start: Vec3[];
    end: Vec3[];
    winner: Vec3[];
  };
}

/** World position of a slide state: y up, centred between start and finish. */
export function toWorld(
  lab: BrachistochroneLab,
  state: { x: number; y: number },
  z: number,
): Vec3 {
  return { x: state.x - lab.span / 2, y: lab.drop / 2 - state.y, z };
}

/** The side of the path the sphere rides on, for a heading (y down). */
export function normalOf(heading: number): Vec3 {
  return { x: Math.sin(heading), y: Math.cos(heading), z: 0 };
}

function atDistance(trajectory: Trajectory, s: number) {
  const { s: along, points } = trajectory;
  let lo = 0;
  let hi = along.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (along[mid]! <= s) lo = mid;
    else hi = mid;
  }
  const a = points[lo]!;
  const b = points[hi]!;
  const f = clamp((s - along[lo]!) / (along[hi]! - along[lo]! || 1));
  return {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    heading: Math.atan2(b.y - a.y, b.x - a.x),
  };
}

const cache = new WeakMap<BrachistochroneLab, Direction>();

export function direct(
  lab: BrachistochroneLab,
  fps: number,
  duration: number,
  size: { width: number; height: number },
): Direction {
  const known = cache.get(lab);
  if (
    known &&
    known.fps === fps &&
    known.duration === duration &&
    known.width === size.width &&
    known.height === size.height
  ) {
    return known;
  }
  const run = brachistochroneRun(lab);
  const lanes = [run.straight, run.curve].map((trajectory, i) => {
    const z = LANE_Z[i]!;
    const centers: Vec3[] = [];
    const normals: Vec3[] = [];
    for (let k = 0; k <= SEGMENTS; k += 1) {
      const p = atDistance(trajectory, (trajectory.length * k) / SEGMENTS);
      centers.push(toWorld(lab, p, z));
      normals.push(normalOf(p.heading));
    }
    return { trajectory, z, centers, normals };
  }) as [Lane, Lane];
  const lowest = Math.min(...lanes.flatMap((l) => l.centers.map((c) => c.y)));
  const floorY = lowest - RADIUS - 0.36;
  const arrivals = [
    arrivalFrame(lab, run.straight, fps),
    arrivalFrame(lab, run.curve, fps),
  ] as [number, number];
  const winner = run.curve.arrival < run.straight.arrival ? 1 : 0;
  const first = lanes[winner].trajectory.arrival;
  const last = lanes[1 - winner]!.trajectory.arrival;
  const faster = Math.round((1 - first / last) * 100);

  // The race, then (for the explanation) the same race again from the
  // start, then the spheres back at the start, as on the first frame.
  const raceEnd = last + 0.1;
  const from = lab.beats.explanation + 18;
  const end = last + 0.02;
  const to = from + end * lab.replaySlowMotion * fps;
  const cut: TimeSegment[] = [
    {
      kind: "run",
      from: lab.releaseFrame,
      to: lab.releaseFrame + raceEnd * lab.slowMotion * fps,
      start: 0,
      end: raceEnd,
    },
    {
      kind: "hold",
      from: lab.beats.explanation + 11,
      to: from,
      start: 0,
      end: 0,
    },
    { kind: "replay", from, to, start: 0, end },
    {
      kind: "hold",
      from: lab.beats.closing + 20,
      to: duration + 1,
      start: 0,
      end: 0,
    },
  ];

  const d: Direction = {
    lab,
    fps,
    duration,
    width: size.width,
    height: size.height,
    run,
    lanes,
    floorY,
    arrivals,
    winner,
    faster,
    replay: { from, to, start: 0, end },
    cut,
    jumps: [lab.beats.explanation + 11, lab.beats.closing + 20],
    keys: [],
    shakes: [],
    landmarks: landmarks(lab, lanes, floorY, winner),
  };
  d.keys = cameraKeys(d);
  // Nothing shakes: the camera never competes with the race.
  d.shakes = [];
  cache.set(lab, d);
  return d;
}

export type Phase = "hook" | "race" | "reveal" | "explanation" | "closing";

export interface Moment {
  frame: number;
  phase: Phase;
  /** Simulated seconds since the release, as shown now. */
  time: number;
  states: [SlideState, SlideState];
  centers: [Vec3, Vec3];
  pose: CameraPose;
  shake: Vec3;
  /** Whether the spheres sit back at the start for the loop. */
  reset: boolean;
  /** The kind of edit segment playing ("run", "replay"...), if any. */
  segment: string | null;
}

/** Simulated time on screen, from the edit. */
export function shownTime(d: Direction, f: number): number {
  return remapTime(d.cut, f).time;
}

export function phaseOf(d: Direction, f: number): Phase {
  const { beats, releaseFrame } = d.lab;
  if (f < releaseFrame) return "hook";
  if (f < beats.reveal) return "race";
  if (f < beats.explanation) return "reveal";
  if (f < beats.closing) return "explanation";
  return "closing";
}

/** 1 while the gate is open: from the release until the closing. */
export function gateOpen(d: Direction, f: number): number {
  const { releaseFrame, beats } = d.lab;
  return Math.min(
    ramp01(f, releaseFrame - 2, releaseFrame + 4),
    1 - ramp01(f, beats.closing + 26, beats.closing + 36),
  );
}

/** 0..1: the spheres fade out and back in around each jump. */
export function presenceAt(d: Direction, f: number): number {
  let shown = 1;
  for (const jump of d.jumps) {
    const age = f - jump;
    if (age > -10 && age < 10) {
      shown = Math.min(
        shown,
        age < 0 ? ramp01(-age, 0, 9) : EASE.outBack(clamp(age / 9)),
      );
    }
  }
  return shown;
}

function ramp01(f: number, a: number, b: number) {
  return EASE.inOutCubic(clamp((f - a) / (b - a)));
}

export function momentAt(d: Direction, f: number): Moment {
  const { time, segment } = remapTime(d.cut, f);
  const states = d.lanes.map((lane) => stateAt(lane.trajectory, time)) as [
    SlideState,
    SlideState,
  ];
  const centers = states.map((s, i) => toWorld(d.lab, s, d.lanes[i]!.z)) as [
    Vec3,
    Vec3,
  ];
  return {
    frame: f,
    phase: phaseOf(d, f),
    time,
    states,
    centers,
    pose: poseAt(d.keys, f),
    shake: shakeAt(d.shakes, f),
    reset: false,
    segment: segment?.kind ?? null,
  };
}

/** Points that shots are composed around. */
function landmarks(
  lab: BrachistochroneLab,
  lanes: [Lane, Lane],
  floorY: number,
  winner: 0 | 1,
): Direction["landmarks"] {
  const { span, drop } = lab;
  const startX = -span / 2;
  const finishX = span / 2;
  const at = (lane: Lane, u: number) =>
    lane.centers[Math.round(u * (lane.centers.length - 1))]!;
  const set = [
    vec(startX - 0.2, drop / 2 + RADIUS + 0.08, 0.4),
    vec(startX - 0.2, drop / 2 + RADIUS + 0.08, -0.4),
    vec(startX - 0.2, floorY, 0.4),
    vec(finishX + 0.45, floorY, 0.42),
    vec(finishX + 0.45, floorY, -0.42),
    vec(finishX + 0.45, -drop / 2, 0.42),
    ...lanes.map((l) => at(l, 0.6)),
  ];
  // The lanes alone, from just above the start to the finish.
  const lanePoints = lanes.flatMap((l) => [
    { ...at(l, 0), y: at(l, 0).y + 0.12 },
    at(l, 0.5),
    at(l, 1),
  ]);
  const start = lanes.flatMap((l) => [
    { ...at(l, 0), y: at(l, 0).y + 0.14 },
    at(l, 0.1),
  ]);
  start.push(vec(startX - 0.15, drop / 2 + 0.2, 0));
  const end = lanes.flatMap((l) => [at(l, 0.82), at(l, 1)]);
  end.push(vec(finishX + 0.1, -drop / 2 - RADIUS, 0.4));
  const w = at(lanes[winner], 1);
  const winnerBox = [-1, 1].flatMap((sx) =>
    [-1, 1].map((sy) => vec(w.x + sx * 0.2, w.y + sy * 0.17, w.z)),
  );
  return {
    finish: vec(finishX + 0.1, -drop / 2, 0),
    set,
    lanes: lanePoints,
    half: [
      ...lanes.flatMap((l) => [
        { ...at(l, 0.5), y: at(l, 0.5).y + 0.1 },
        at(l, 1),
      ]),
      vec(finishX + 0.45, -drop / 2 - RADIUS, 0.42),
      vec(finishX + 0.45, -drop / 2 - RADIUS, -0.42),
    ],
    start,
    end,
    winner: winnerBox,
  };
}

/** Where the set sits on screen: under the headlines, over the scores. */
function contentBox(d: Direction): ScreenBox {
  const k = d.width / 1080;
  return {
    left: 80 * k,
    top: 640 * (d.height / 1920),
    right: 1000 * k,
    bottom: 1400 * (d.height / 1920),
  };
}

/**
 * The camera. Vertical video wants the set to run into depth, so most
 * shots look up the slope from the finish side, where the start tower rises
 * to the top of the frame and the spheres race towards the lens. Shots are
 * composed by fitting landmarks into parts of the picture.
 */
function cameraKeys(d: Direction): CameraKey[] {
  const { lab, duration, winner, landmarks: marks, width, height } = d;
  const { beats, releaseFrame: go } = lab;
  const kx = width / 1080;
  const ky = height / 1920;
  const box = (left: number, top: number, right: number, bottom: number) => ({
    left: left * kx,
    top: top * ky,
    right: right * kx,
    bottom: bottom * ky,
  });
  const shot = (
    frame: number,
    angle: { yaw: number; pitch: number; fov: number; roll?: number },
    points: Vec3[],
    area: ScreenBox,
    ease?: CameraKey["ease"],
  ): CameraKey => ({
    frame,
    ease,
    ...fitShot({ roll: 0, ...angle }, points, area, width, height),
  });
  const content = contentBox(d);
  const wide = (
    frame: number,
    yaw: number,
    pitch: number,
    ease?: CameraKey["ease"],
  ) => shot(frame, { yaw, pitch, fov: 48 }, marks.set, content, ease);
  // The hero composition: both whole tracks, large, from the finish side
  // so the drop reads and the spheres come towards the lens.
  const hero = (
    frame: number,
    yaw: number,
    scale: number,
    ease?: CameraKey["ease"],
  ) => {
    const key = shot(
      frame,
      { yaw, pitch: 0.24, fov: 44 },
      marks.lanes,
      box(60, 570, 1020, 1300),
      ease,
    );
    return { ...key, distance: key.distance * scale };
  };
  // "still" holds the hero composition through the race and the result.
  const still = lab.camera === "still";
  const race = still
    ? [
        hero(0, 0.8, 1.04),
        hero(beats.reveal + 26, 0.8, 1.04),
        hero(beats.explanation - 2, 0.8, 1.04),
      ]
    : [
        hero(0, 0.8, 1.06),
        hero(go + 8, 0.82, 1, "inOutSine"),
        hero(Math.round(d.arrivals[winner]!), 0.88, 0.97, "inOutSine"),
        // The result: closer on the finish, with both lanes' ends in view.
        shot(
          beats.reveal + 26,
          { yaw: 1.0, pitch: 0.2, fov: 42 },
          marks.half,
          box(90, 640, 990, 1290),
          "inOutCubic",
        ),
        shot(
          beats.explanation - 2,
          { yaw: 1.06, pitch: 0.2, fov: 42 },
          marks.half,
          box(80, 630, 1000, 1300),
          "linear",
        ),
      ];
  return [
    ...race,
    // The explanation, side on, where both shapes read clearly.
    shot(
      beats.explanation + 16,
      { yaw: 0.5, pitch: 0.16, fov: 44 },
      marks.lanes,
      box(170, 640, 1030, 1300),
      "inOutCubic",
    ),
    shot(
      beats.closing,
      { yaw: 0.56, pitch: 0.17, fov: 44 },
      marks.lanes,
      box(170, 640, 1030, 1300),
      "linear",
    ),
    // The payoff: back to the opening picture, so the end meets the start.
    hero(duration - 10, 0.8, 1.06, "inOutCubic"),
    hero(duration, 0.8, 1.06),
  ];
}
