/**
 * An articulated character, posed from the time alone.
 *
 * The body is a hierarchy: hips → torso → neck → head, shoulders → upper arm
 * → forearm → hand, hips → thigh → shin → foot. Lengths are fractions of the
 * standing height and angles are radians, measured from hanging straight
 * down (limbs) or standing straight up (torso), positive towards where the
 * character faces.
 *
 * Walking is driven by distance, not by time: a foot is planted at a point
 * on the ground and stays there until it lifts, and the legs reach it with
 * two-bone IK, so feet do not slide whatever the speed. The hips sit as high
 * as both legs allow, which gives the walk its natural rise and fall.
 */
import type { AnimationCharacter, ClipUse, WalkStyle } from "@framebop/core";
import { EASE, clamp, hash, lerp, noise, smoothstep, weight } from "./timing";

const { PI, sin, cos, atan2, acos, sqrt, abs, exp, log, max, min, floor } =
  Math;

/** Proportions, as fractions of standing height. */
export const BODY = {
  ankle: 0.035,
  thigh: 0.255,
  shin: 0.245,
  /** Hip joint height when standing at ease, knees soft. */
  hip: 0.52,
  shoulder: 0.285,
  neck: 0.325,
  upperArm: 0.165,
  forearm: 0.15,
  toe: 0.085,
  heel: 0.03,
} as const;
const LEG = BODY.thigh + BODY.shin;

/** Fraction of a step cycle a foot spends on the ground. */
const STANCE = 0.6;
/** Within the stance: rolling down from the heel, then up onto the toes. */
const HEEL_ROLL = 0.12;
const TOE_ROLL = 0.4;

export interface Point {
  x: number;
  y: number;
}

/** An ankle in the character's frame (forward is +x, up is -y). */
interface Foot extends Point {
  /** Positive when the heel is raised. */
  angle: number;
}

export interface ArmPose {
  shoulder: Point;
  elbow: Point;
  wrist: Point;
  /** Absolute angles of the forearm and the hand. */
  forearm: number;
  hand: number;
}

export interface LegPose {
  hip: Point;
  knee: Point;
  ankle: Point;
  foot: number;
}

export interface Face {
  /** 0 closed, 1 open, more is wide. */
  eyes: number;
  /** -1 frowning, 0 at rest, 1 raised. */
  brows: number;
  /** 0 closed to 1 wide open. */
  mouth: number;
  /** 0 a wide mouth, 1 a round "O". */
  round: number;
}

/** Everything needed to draw a character at one moment. */
export interface Pose {
  /** Root on the ground, in the layer's pixels. */
  x: number;
  y: number;
  facing: 1 | -1;
  height: number;
  hips: Point;
  lean: number;
  neck: Point;
  head: number;
  /** Near (drawn in front) and far arm and leg. */
  arms: [ArmPose, ArmPose];
  legs: [LegPose, LegPose];
  face: Face;
  /** Horizontal offset of the tunic's hem, trailing the movement. */
  hem: number;
}

// ------------------------------------------------------------------ walking

interface WalkPlan {
  from: number;
  to: number;
  x0: number;
  x1: number;
  facing: 1 | -1;
  /** Samples per walk, evenly spaced in time. */
  n: number;
  /** Speed as a fraction of the top speed. */
  ratio: Float64Array;
  /** Pixels covered. */
  dist: Float64Array;
  /** Step cycles completed; one cycle is two steps. */
  phase: Float64Array;
  phaseEnd: number;
  /** Step length at top speed, in pixels. */
  stepPx: number;
  /** Cadence scale that makes the walk end with both feet down. */
  scale: number;
  /** Phase offset of each foot: the one ahead starts, the other follows. */
  offsets: [number, number];
  /** Where each foot was planted before the walk, and after it. */
  rest: [number, number];
  end: [number, number];
  endHeel: [number, number];
  style: WalkStyle;
}

function at(plan: WalkPlan, values: Float64Array, time: number): number {
  const u = clamp((time - plan.from) / (plan.to - plan.from)) * plan.n;
  const i = min(floor(u), plan.n - 1);
  return lerp(values[i]!, values[i + 1]!, u - i);
}

function timeOfPhase(plan: WalkPlan, phase: number): number {
  if (phase <= 0) return plan.from;
  if (phase >= plan.phaseEnd) return plan.to;
  let lo = 0;
  let hi = plan.n;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (plan.phase[mid]! < phase) lo = mid;
    else hi = mid;
  }
  const a = plan.phase[lo]!;
  const b = plan.phase[hi]!;
  const f = b > a ? (phase - a) / (b - a) : 0;
  return plan.from + ((lo + f) / plan.n) * (plan.to - plan.from);
}

function rootX(plan: WalkPlan, time: number): number {
  return plan.x0 + plan.facing * at(plan, plan.dist, time);
}

/** Steps shorten as the walk slows; at a stop they are half as long. */
function cycleLength(plan: WalkPlan, ratio: number): number {
  return (2 * plan.stepPx * (0.5 + 0.5 * ratio)) / plan.scale;
}

/** Where foot `i` lands at the start of its `k`th cycle, in pixels. */
function landing(plan: WalkPlan, i: number, k: number): number {
  const phase = k - plan.offsets[i]!;
  if (phase <= 1e-9) return plan.rest[i]!;
  const time = timeOfPhase(plan, phase);
  const ratio = at(plan, plan.ratio, time);
  return rootX(plan, time) + plan.facing * 0.3 * cycleLength(plan, ratio);
}

/**
 * A foot on the ground whose ankle is above `ground` when flat: rolled up
 * onto its toes (positive angle, the toe stays put) or back onto its heel
 * (negative, the heel stays put).
 */
function planted(ground: number, angle: number): Foot {
  if (angle === 0) return { x: ground, y: -BODY.ankle, angle: 0 };
  const pivot = angle > 0 ? BODY.toe : -BODY.heel;
  const vx = -pivot;
  const vy = -BODY.ankle;
  const c = cos(angle);
  const s = sin(angle);
  return { x: ground + pivot + vx * c - vy * s, y: vx * s + vy * c, angle };
}

/** The foot's angle through the stance: heel strike, flat, push-off. */
function stanceAngle(style: WalkStyle, p: number): number {
  if (p < HEEL_ROLL) return -style.heelStrike * (1 - smoothstep(p / HEEL_ROLL));
  if (p > TOE_ROLL) {
    return style.toeOff * smoothstep((p - TOE_ROLL) / (STANCE - TOE_ROLL));
  }
  return 0;
}

/** Foot `i` during a walk, in the frame of a root at `root` pixels. */
function walkFoot(
  plan: WalkPlan,
  i: number,
  phase: number,
  root: number,
  height: number,
): Foot {
  const local = (px: number) => ((px - root) * plan.facing) / height;
  const q = phase + plan.offsets[i]!;
  const k = floor(q + 1e-9);
  const p = q - k;
  const from = landing(plan, i, k);
  const { style } = plan;
  if (p < STANCE || phase >= plan.phaseEnd - 1e-9) {
    return planted(local(from), stanceAngle(style, p));
  }
  // Swinging: the foot leaves toe first, lifts highest early (the knee
  // folds as it passes the other leg) and comes down heel first.
  const s = (p - STANCE) / (1 - STANCE);
  const to = landing(plan, i, k + 1);
  const start = planted(local(from), style.toeOff);
  const end = planted(local(to), -style.heelStrike);
  const lift = style.stepHeight * clamp(abs(to - from) / plan.stepPx, 0.3, 1.2);
  const angle =
    s < 0.4
      ? lerp(style.toeOff, 0.12, smoothstep(s / 0.4))
      : lerp(0.12, -style.heelStrike, smoothstep((s - 0.4) / 0.45));
  return {
    x: lerp(start.x, end.x, smoothstep(s)),
    y: lerp(start.y, end.y, s) - lift * sin(PI * s ** 0.85),
    angle,
  };
}

function planWalk(
  use: ClipUse,
  x0: number,
  rest: [number, number],
  height: number,
  stride: number,
  facing: 1 | -1,
  style: WalkStyle,
): WalkPlan {
  const span = max(1, use.to - use.from);
  const x1 = use.toX ?? x0;
  const distance = abs(x1 - x0);
  const n = max(8, Math.ceil(span * 4));
  const ratio = new Float64Array(n + 1);
  const dist = new Float64Array(n + 1);
  const phase = new Float64Array(n + 1);
  // Speed rises over the first steps and falls over the last ones.
  const rise = min(0.3, 20 / span);
  const fall = min(0.35, 28 / span);
  for (let i = 0; i <= n; i += 1) {
    const u = i / n;
    ratio[i] =
      u < rise
        ? smoothstep(u / rise)
        : u > 1 - fall
          ? smoothstep((1 - u) / fall)
          : 1;
  }
  const dt = span / n;
  for (let i = 1; i <= n; i += 1) {
    dist[i] = dist[i - 1]! + ((ratio[i - 1]! + ratio[i]!) / 2) * dt;
  }
  const top = distance > 0 ? distance / dist[n]! : 0;
  const stepPx = stride * height;
  const cadence = (r: number) => (r * top) / (2 * stepPx * (0.5 + 0.5 * r));
  for (let i = 1; i <= n; i += 1) {
    dist[i] = dist[i]! * top;
    phase[i] =
      phase[i - 1]! + ((cadence(ratio[i - 1]!) + cadence(ratio[i]!)) / 2) * dt;
  }
  // Ending on a whole or half cycle puts both feet on the ground.
  const raw = phase[n]!;
  const phaseEnd = distance > 0 ? max(1, Math.round(raw * 2) / 2) : 0;
  const scale = raw > 0 ? phaseEnd / raw : 1;
  for (let i = 1; i <= n; i += 1) phase[i] = phase[i]! * scale;
  const direction = x1 === x0 ? facing : x1 > x0 ? 1 : -1;
  const ahead = direction * (rest[0] - rest[1]) >= 0 ? 0 : 1;
  const offsets: [number, number] = ahead === 0 ? [0, 0.5] : [0.5, 0];
  const plan: WalkPlan = {
    from: use.from,
    to: use.from + span,
    x0,
    x1,
    facing: direction,
    n,
    ratio,
    dist,
    phase,
    phaseEnd,
    stepPx,
    scale,
    offsets,
    rest,
    end: rest,
    endHeel: [0, 0],
    style,
  };
  if (distance > 0) {
    const end: [number, number] = [0, 0];
    const endHeel: [number, number] = [0, 0];
    for (const i of [0, 1]) {
      const q = phaseEnd + offsets[i]!;
      const k = floor(q + 1e-9);
      end[i] = landing(plan, i, k);
      endHeel[i] = stanceAngle(style, q - k);
    }
    plan.end = end;
    plan.endHeel = endHeel;
  }
  return plan;
}

interface CharacterPlan {
  walks: WalkPlan[];
  /** Feet before any walk. */
  rest: [number, number];
  clips: ClipUse[];
}

const plans = new WeakMap<AnimationCharacter, CharacterPlan>();

function planOf(character: AnimationCharacter): CharacterPlan {
  const cached = plans.get(character);
  if (cached) return cached;
  const { height, facing } = character;
  const gap = 0.03 * height * facing;
  const rest: [number, number] = [character.x + gap, character.x - gap];
  const walks: WalkPlan[] = [];
  let x = character.x;
  let feet = rest;
  let direction = facing;
  for (const use of [...character.timeline]
    .filter((clip) => clip.clip === "walk")
    .sort((a, b) => a.from - b.from)) {
    const walk = planWalk(
      use,
      x,
      feet,
      height,
      character.stride,
      direction,
      character.walk,
    );
    walks.push(walk);
    x = walk.x1;
    feet = walk.end;
    direction = walk.facing;
  }
  const plan: CharacterPlan = {
    walks,
    rest,
    clips: character.timeline.filter((clip) => clip.clip !== "walk"),
  };
  plans.set(character, plan);
  return plan;
}

interface Locomotion {
  x: number;
  facing: 1 | -1;
  feet: [Foot, Foot];
  /** Speed as a fraction of top speed, and its change per frame. */
  ratio: number;
  accel: number;
  /** Step phase of the near foot, for the arms' swing. */
  swing: number;
  /** Through each step: 0 at contact, about 0.15 down, 0.5 passing, 0.65 up. */
  step: number;
  /** Frames since the last walk ended, and how fast it was going. */
  since: number;
}

function locomotion(character: AnimationCharacter, time: number): Locomotion {
  const plan = planOf(character);
  const { height } = character;
  let x = character.x;
  let facing = character.facing;
  let feet: [number, number] = plan.rest;
  let heels: [number, number] = [0, 0];
  let ended = -1;
  for (const walk of plan.walks) {
    if (time < walk.from) break;
    if (time <= walk.to && walk.phaseEnd > 0) {
      const phase = at(walk, walk.phase, time);
      const root = rootX(walk, time);
      const ratio = at(walk, walk.ratio, time);
      const step = 1 / walk.n;
      const ahead = at(walk, walk.ratio, time + (walk.to - walk.from) * step);
      return {
        x: root,
        facing: walk.facing,
        feet: [
          walkFoot(walk, 0, phase, root, height),
          walkFoot(walk, 1, phase, root, height),
        ],
        ratio,
        accel: (ahead - ratio) / ((walk.to - walk.from) * step),
        swing: phase + walk.offsets[0],
        step: (2 * phase) % 1,
        since: -1,
      };
    }
    x = walk.x1;
    facing = walk.facing;
    feet = walk.end;
    heels = walk.endHeel;
    ended = walk.to;
  }
  const since = ended < 0 ? -1 : time - ended;
  // A heel still raised from the last step settles back down.
  const settle = since < 0 ? 0 : 1 - smoothstep(since / 8);
  const local = (px: number) => ((px - x) * facing) / height;
  return {
    x,
    facing,
    feet: [
      planted(local(feet[0]), heels[0] * settle),
      planted(local(feet[1]), heels[1] * settle),
    ],
    ratio: 0,
    accel: 0,
    swing: 0,
    step: 0,
    since,
  };
}

/** Rise and fall of the pelvis while walking, in units of height. */
function bob(character: AnimationCharacter, time: number): number {
  const move = locomotion(character, time);
  return (
    character.walk.bounce * move.ratio * -0.5 * cos(2 * PI * (move.step - 0.15))
  );
}

/** The character's position on the ground, in layer pixels. */
export function characterX(character: AnimationCharacter, time: number) {
  const plan = planOf(character);
  let x = character.x;
  for (const walk of plan.walks) {
    if (time < walk.from) break;
    if (time <= walk.to && walk.phaseEnd > 0) return rootX(walk, time);
    x = walk.x1;
  }
  return x;
}

// ---------------------------------------------------------------- the body

/** The smaller of the values, without a corner where they cross. */
function softMin(values: number[], k = 0.012): number {
  const low = min(...values);
  return low - k * log(values.reduce((sum, v) => sum + exp(-(v - low) / k), 0));
}

const along = (angle: number, length: number): Point => ({
  x: sin(angle) * length,
  y: cos(angle) * length,
});
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });

/**
 * Two-bone IK: the absolute angles of the bones from `root` to reach
 * `target`. `bend` picks the side the middle joint goes to.
 */
export function solveTwoBone(
  root: Point,
  target: Point,
  first: number,
  second: number,
  bend: 1 | -1,
): [number, number] {
  const dx = target.x - root.x;
  const dy = target.y - root.y;
  const reach = clamp(
    sqrt(dx * dx + dy * dy),
    abs(first - second) + 1e-6,
    first + second - 1e-6,
  );
  const direction = atan2(dx, dy);
  const a = acos(
    clamp(
      (first * first + reach * reach - second * second) / (2 * first * reach),
      -1,
      1,
    ),
  );
  const b = acos(
    clamp(
      (second * second + reach * reach - first * first) / (2 * second * reach),
      -1,
      1,
    ),
  );
  return [direction + bend * a, direction - bend * b];
}

interface ArmAngles {
  /** Upper arm relative to the torso, forearm relative to the upper arm. */
  upper: number;
  lower: number;
  hand: number;
}

const blendArm = (a: ArmAngles, b: ArmAngles, w: number): ArmAngles => ({
  upper: lerp(a.upper, b.upper, w),
  lower: lerp(a.lower, b.lower, w),
  hand: lerp(a.hand, b.hand, w),
});

/** What the clips on the timeline add at one moment. */
interface Actions {
  lean: number;
  head: number;
  hipsUp: number;
  heel: number;
  arms: [ArmAngles | null, ArmAngles | null];
  armWeights: [number, number];
  face: Face;
  reach: { use: ClipUse; weight: number } | null;
}

/** The shape of a surprise over its first frames: dip, jolt, settle. */
const SURPRISE: [number, number][] = [
  [0, 0],
  [4, -0.25],
  [9, 1.15],
  [14, 0.92],
  [20, 1],
];

function surpriseCurve(local: number): number {
  for (let i = 1; i < SURPRISE.length; i += 1) {
    const [f1, v1] = SURPRISE[i]!;
    if (local < f1) {
      const [f0, v0] = SURPRISE[i - 1]!;
      return lerp(v0, v1, EASE.inOutSine((local - f0) / (f1 - f0)));
    }
  }
  return 1;
}

function actions(
  character: AnimationCharacter,
  plan: CharacterPlan,
  time: number,
  speech: number | null,
): Actions {
  const seed = hash(character.id.length * 31 + character.height);
  const result: Actions = {
    lean: 0,
    head: 0,
    hipsUp: 0,
    heel: 0,
    arms: [null, null],
    armWeights: [0, 0],
    face: { eyes: 1, brows: 0, mouth: 0, round: 0 },
    reach: null,
  };
  const setArm = (which: "front" | "back", pose: ArmAngles, w: number) => {
    const i = which === "front" ? 0 : 1;
    const current = result.arms[i];
    result.arms[i] = current ? blendArm(current, pose, w) : pose;
    result.armWeights[i] = max(result.armWeights[i]!, w);
  };
  let talking = 0;
  for (const use of plan.clips) {
    const w = weight(time, use.from, use.to, use.blend);
    if (w <= 0) continue;
    const local = time - use.from;
    switch (use.clip) {
      case "reach":
        result.reach = { use, weight: w };
        result.head += 0.18 * w;
        break;
      case "surprise": {
        const s = surpriseCurve(local) * w;
        result.lean += -0.2 * s;
        result.head += -0.14 * s;
        result.hipsUp += 0.02 * s;
        result.heel += 0.3 * max(0, s);
        result.face.eyes = lerp(result.face.eyes, 1.45, clamp(s));
        result.face.brows = lerp(result.face.brows, 1, clamp(s));
        result.face.round = lerp(result.face.round, 1, clamp(s));
        result.face.mouth = max(result.face.mouth, 0.55 * clamp(s));
        const jolt = clamp(s);
        setArm("front", { upper: 1.35, lower: 1.45, hand: -0.5 }, jolt);
        setArm("back", { upper: 0.95, lower: 1.6, hand: -0.4 }, jolt);
        break;
      }
      case "talk": {
        talking = max(talking, w);
        const beat = noise(time / 9, seed * 97);
        setArm(
          use.arm,
          { upper: 0.55 + 0.12 * beat, lower: 1.05 + 0.2 * beat, hand: -0.6 },
          w,
        );
        result.face.brows += 0.25 * w * max(0, noise(time / 13, seed * 7));
        break;
      }
      case "gesture": {
        // A wave: the arm raised high, the forearm swinging from the elbow.
        const wave = sin((2 * PI * local) / 16);
        setArm(
          use.arm,
          { upper: 2.25 + 0.06 * wave, lower: 0.45 + 0.4 * wave, hand: -0.15 },
          w,
        );
        result.lean += -0.03 * w;
        result.head += -0.06 * w;
        break;
      }
      case "walk":
        break;
    }
  }
  // The mouth follows the narration when this character is its voice;
  // otherwise a talk clip moves it with a speech-like rhythm.
  let mouth: number;
  if (character.speaksNarration && speech !== null) {
    mouth = speech;
  } else if (talking > 0) {
    const syllable = 0.5 + 0.5 * sin(time * 1.9 + 3 * noise(time / 5, seed));
    mouth =
      talking * syllable * (0.4 + 0.6 * max(0, noise(time / 7, seed + 1)));
  } else {
    mouth = 0;
  }
  result.face.mouth = clamp(max(result.face.mouth, mouth));
  result.head += 0.07 * mouth * (character.speaksNarration ? 1 : talking);
  return result;
}

function blink(character: AnimationCharacter, time: number): number {
  const period = 96;
  const bucket = floor(time / period);
  const start = bucket * period + hash(bucket, character.id.length + 17) * 70;
  const d = time - start;
  return d >= 0 && d < 6 ? abs(d - 3) / 3 : 1;
}

/** The pose of a character at a time, in the timeline's frames. */
export function poseAt(
  character: AnimationCharacter,
  time: number,
  speech: number | null = null,
): Pose {
  const plan = planOf(character);
  const { height } = character;
  const move = locomotion(character, time);
  const act = actions(character, plan, time, speech);
  const breath = sin((2 * PI * time) / 105 + character.x * 0.01);

  // Feet: planted or stepping, then rolled onto the toes if a clip says so.
  const feet = move.feet.map((foot) =>
    act.heel > 0 && foot.angle >= 0 && foot.y >= -BODY.ankle - 1e-6
      ? planted(foot.x, act.heel)
      : foot,
  ) as [Foot, Foot];

  const style = character.walk;
  const r = move.ratio;
  // The pelvis and shoulders turn against each other: the near hip comes
  // forward with the near leg while the near shoulder goes back.
  const turn = cos(2 * PI * (move.swing - 0.04));
  const pelvisTurn = style.twist * 0.8 * r * cos(2 * PI * move.swing);
  const shoulderTurn = -style.twist * r * turn;

  // Hips: dip just after each contact and rise as the body passes over the
  // standing leg, never higher than both legs reach. Weight shifts forward
  // a little faster as the body rises.
  const hipsX =
    0.012 * r +
    0.008 * r * sin(2 * PI * (move.step - 0.1)) +
    0.004 * sin((2 * PI * time) / 150) -
    0.02 * act.lean;
  const hipJoint = (i: number) => hipsX + (i === 0 ? pelvisTurn : -pelvisTurn);
  const reachable = feet.map((foot, i) => {
    const dx = foot.x - hipJoint(i);
    const limit = (LEG * 0.995) ** 2;
    return -foot.y + sqrt(max(0, limit - dx * dx));
  });
  const crouch = act.reach ? 0.025 * act.reach.weight : 0;
  const hipsY = softMin([
    BODY.hip -
      0.012 * r +
      bob(character, time) +
      0.003 * breath +
      act.hipsUp -
      crouch,
    ...reachable,
  ]);
  const hips: Point = { x: hipsX, y: -hipsY };

  // Torso: leans into the walk, more while speeding up, back when slowing,
  // and a little more on each down.
  let lean =
    0.03 +
    style.lean * r +
    0.02 * r * cos(2 * PI * (move.step - 0.2)) +
    clamp(move.accel * 8, -0.06, 0.08) +
    act.lean;
  // A short sway after stopping: the upper body carries on a little.
  if (move.since >= 0 && move.since < 30) {
    lean += 0.05 * exp(-move.since / 7) * sin(move.since / 2.6);
  }

  // Arms: swing against the legs from the shoulder; the forearm and hand
  // follow a beat later, bending most just after the arm swings forward.
  const swing = style.armSwing * min(1, r * 1.3);
  const restArm = (i: number): ArmAngles => {
    const side = i === 0 ? -1 : 1;
    const at = (lag: number) => side * cos(2 * PI * (move.swing - 0.04 - lag));
    const a = swing * at(0) + (i === 0 ? 0.05 : -0.03);
    return {
      upper: a + 0.015 * breath,
      lower: 0.14 + 0.1 * r + style.elbowBend * r * max(0, at(0.07)),
      hand: 0.1 + 0.25 * r * max(0, at(0.14)),
    };
  };
  let arms = [restArm(0), restArm(1)].map((base, i) => {
    const pose = act.arms[i];
    return pose ? blendArm(base, pose, act.armWeights[i]!) : base;
  });

  // Reaching: lean in until the hand can get there, then IK the arm.
  if (act.reach?.use.target) {
    const { use, weight: w } = act.reach;
    const target: Point = {
      x: ((use.target!.x - move.x) * move.facing) / height,
      y: (use.target!.y - character.groundY) / height,
    };
    const i = use.arm === "front" ? 0 : 1;
    const arm = BODY.upperArm + BODY.forearm;
    const shoulderAt = (angle: number) =>
      add(hips, {
        x: sin(angle) * BODY.shoulder,
        y: -cos(angle) * BODY.shoulder,
      });
    const far = Math.hypot(
      target.x - shoulderAt(lean).x,
      target.y - shoulderAt(lean).y,
    );
    lean += w * clamp((far - arm * 0.85) / arm, 0, 0.5);
    const [upper, forearm] = solveTwoBone(
      shoulderAt(lean),
      target,
      BODY.upperArm,
      BODY.forearm,
      -1,
    );
    const ik: ArmAngles = {
      upper: upper - lean,
      lower: forearm - upper,
      hand: 0.2,
    };
    arms = arms.map((base, j) => (j === i ? blendArm(base, ik, w) : base));
  }

  // Legs from the hips to each ankle; knees bend forward.
  const legs = feet.map((foot, i): LegPose => {
    const hip = { x: hipJoint(i), y: hips.y };
    const [thigh, shin] = solveTwoBone(hip, foot, BODY.thigh, BODY.shin, 1);
    const knee = add(hip, along(thigh, BODY.thigh));
    return {
      hip,
      knee,
      ankle: add(knee, along(shin, BODY.shin)),
      foot: foot.angle,
    };
  }) as [LegPose, LegPose];

  const up = (length: number): Point => ({
    x: sin(lean) * length,
    y: -cos(lean) * length,
  });
  const shoulder = add(hips, up(BODY.shoulder));
  const armPoses = arms.map((angles, i): ArmPose => {
    const base = add(shoulder, {
      x: i === 0 ? 0.004 + shoulderTurn : -0.012 - shoulderTurn,
      y: 0,
    });
    const upper = lean + angles.upper;
    const forearm = upper + angles.lower;
    const elbow = add(base, along(upper, BODY.upperArm));
    const wrist = add(elbow, along(forearm, BODY.forearm));
    return {
      shoulder: base,
      elbow,
      wrist,
      forearm,
      hand: forearm + angles.hand,
    };
  }) as [ArmPose, ArmPose];

  // The head steadies itself against the torso's lean, and nods after the
  // body's rise and fall, a few frames late.
  const lag = style.headLag;
  const nod =
    lag > 0 ? 4 * (bob(character, time - lag) - bob(character, time)) : 0;
  const head = -0.45 * (lean - 0.05) + nod + act.head + 0.02 * breath;

  // The hem trails the movement and swings on after a stop.
  let hem = -0.05 * move.ratio;
  if (move.since >= 0 && move.since < 40) {
    hem += 0.035 * exp(-move.since / 9) * sin(move.since / 3);
  }

  const face = { ...act.face, eyes: act.face.eyes * blink(character, time) };
  return {
    x: move.x,
    y: character.groundY,
    facing: move.facing,
    height,
    hips,
    lean,
    neck: add(hips, up(BODY.neck)),
    head: lean + head,
    arms: armPoses,
    legs,
    face,
    hem,
  };
}

/** Where a foot's ankle is in the layer, for checking contact in tests. */
export function ankleInLayer(pose: Pose, leg: 0 | 1): Point {
  const ankle = pose.legs[leg].ankle;
  return {
    x: pose.x + ankle.x * pose.facing * pose.height,
    y: pose.y + ankle.y * pose.height,
  };
}
