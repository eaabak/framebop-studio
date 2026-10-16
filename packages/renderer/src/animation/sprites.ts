/**
 * How a sprite character's pictures are placed on its skeleton. Both the
 * SVG and the PixiJS renderer draw from this list, so they agree.
 */
import type { SpritePart, SpriteRig } from "@framebop/core";
import type { Point, Pose } from "./rig";

const { atan2, hypot, sin, cos } = Math;

/** One picture, placed in the character's units (forward +x, up -y). */
export interface SpriteOp {
  image: string;
  /** Where the picture's pivot goes. */
  x: number;
  y: number;
  /** Radians, clockwise. */
  rotation: number;
  /** From picture pixels to character units. */
  scaleX: number;
  scaleY: number;
  /** The pivot, in picture pixels. */
  pivot: Point;
  /** On the far side of the body, drawn darker. */
  far: boolean;
}

/** Angle from straight down, positive forward. */
const downAngle = (dx: number, dy: number) => atan2(dx, dy);

/** A limb picture from one joint to the next, stretched to fit if it can. */
function limb(
  part: SpritePart,
  from: Point,
  to: Point,
  unit: number,
  far: boolean,
): SpriteOp {
  const tip = part.tip ?? { x: part.pivot.x, y: part.pivot.y + 1 };
  const drawn = downAngle(tip.x - part.pivot.x, tip.y - part.pivot.y);
  const target = downAngle(to.x - from.x, to.y - from.y);
  let stretch = 1;
  if (part.tip) {
    const length = hypot(part.tip.x - part.pivot.x, part.tip.y - part.pivot.y);
    if (length > 0)
      stretch = hypot(to.x - from.x, to.y - from.y) / (length * unit);
  }
  return {
    image: part.image,
    x: from.x,
    y: from.y,
    rotation: drawn - target,
    scaleX: unit,
    scaleY: unit * stretch,
    pivot: part.pivot,
    far,
  };
}

/** A picture turned by `rotation` around a point. */
function placed(
  part: SpritePart,
  at: Point,
  rotation: number,
  unit: number,
  far = false,
): SpriteOp {
  return {
    image: part.image,
    x: at.x,
    y: at.y,
    rotation,
    scaleX: unit,
    scaleY: unit,
    pivot: part.pivot,
    far,
  };
}

/** The pictures of a sprite character in drawing order, far to near. */
export function spriteOps(rig: SpriteRig, pose: Pose): SpriteOp[] {
  const unit = 1 / rig.pixelsPerHeight;
  const { parts } = rig;
  const ops: SpriteOp[] = [];
  const arm = (i: 0 | 1) => {
    const a = pose.arms[i];
    const far = i === 1;
    ops.push(limb(parts.upperArm, a.shoulder, a.elbow, unit, far));
    ops.push(limb(parts.forearm, a.elbow, a.wrist, unit, far));
    ops.push(placed(parts.hand, a.wrist, -a.hand, unit, far));
  };
  const leg = (i: 0 | 1) => {
    const l = pose.legs[i];
    const far = i === 1;
    ops.push(limb(parts.thigh, l.hip, l.knee, unit, far));
    ops.push(limb(parts.shin, l.knee, l.ankle, unit, far));
    ops.push(placed(parts.foot, l.ankle, l.foot, unit, far));
  };
  arm(1);
  leg(1);
  leg(0);
  ops.push(placed(parts.torso, pose.hips, pose.lean, unit));
  if (parts.skirt) {
    // The skirt hangs from the hips and follows the thighs part of the way.
    const thighs =
      pose.legs.reduce(
        (sum, l) => sum + downAngle(l.knee.x - l.hip.x, l.knee.y - l.hip.y),
        0,
      ) / 2;
    ops.push(
      placed(parts.skirt, pose.hips, -0.45 * thighs + 0.3 * pose.lean, unit),
    );
  }
  ops.push(placed(parts.head, pose.neck, pose.head, unit));
  // Face features sit at fixed points on the head and turn with it.
  const onHead = (p: Point): Point => ({
    x: pose.neck.x + p.x * cos(pose.head) - p.y * sin(pose.head),
    y: pose.neck.y + p.x * sin(pose.head) + p.y * cos(pose.head),
  });
  const { face } = pose;
  const eyes =
    face.eyes < 0.25
      ? rig.eyes.closed
      : face.eyes > 1.2
        ? rig.eyes.wide
        : rig.eyes.open;
  ops.push(placed(eyes, onHead(rig.face.eyes), pose.head, unit));
  const mouth =
    face.mouth < 0.06
      ? rig.mouths.closed
      : face.round > 0.5
        ? rig.mouths.round
        : face.mouth < 0.45
          ? rig.mouths.small
          : rig.mouths.wide;
  ops.push(placed(mouth, onHead(rig.face.mouth), pose.head, unit));
  arm(0);
  return ops;
}
