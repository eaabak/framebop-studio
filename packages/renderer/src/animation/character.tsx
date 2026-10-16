/**
 * Draws a posed character in flat vector shapes, in units of its height.
 * The far arm and leg are drawn behind the body and slightly darker.
 */
import type {
  AnimationCharacter,
  AnimationSpec,
  SpriteRig,
} from "@framebop/core";
import { shade } from "./props";
import type { ArmPose, LegPose, Point, Pose } from "./rig";
import { spriteOps } from "./sprites";

const { sin, cos, min, max, PI } = Math;
const DEG = 180 / PI;

type Style = AnimationCharacter["style"];

const at = (p: Point) => `${p.x.toFixed(4)} ${p.y.toFixed(4)}`;

function Limb(props: { from: Point; to: Point; width: number; color: string }) {
  return (
    <line
      x1={props.from.x}
      y1={props.from.y}
      x2={props.to.x}
      y2={props.to.y}
      stroke={props.color}
      strokeWidth={props.width}
      strokeLinecap="round"
    />
  );
}

function Leg({
  leg,
  style,
  far,
}: {
  leg: LegPose;
  style: Style;
  far: boolean;
}) {
  const skin = far ? shade(style.skin, -0.18) : style.skin;
  const sandal = far ? shade(style.sandal, -0.2) : style.sandal;
  return (
    <g>
      <Limb from={leg.hip} to={leg.knee} width={0.07} color={skin} />
      <Limb from={leg.knee} to={leg.ankle} width={0.054} color={skin} />
      <g transform={`translate(${at(leg.ankle)}) rotate(${leg.foot * DEG})`}>
        <path
          d="M -0.03 -0.02 L -0.034 0.03 L 0.088 0.032 Q 0.094 0.012 0.07 0.006 L 0.018 -0.012 Z"
          fill={skin}
        />
        <line
          x1={-0.036}
          y1={0.034}
          x2={0.092}
          y2={0.034}
          stroke={sandal}
          strokeWidth={0.012}
          strokeLinecap="round"
        />
        <line
          x1={0.03}
          y1={0.032}
          x2={0.012}
          y2={-0.006}
          stroke={sandal}
          strokeWidth={0.008}
        />
        <line
          x1={0.062}
          y1={0.032}
          x2={0.05}
          y2={0.006}
          stroke={sandal}
          strokeWidth={0.008}
        />
        <line
          x1={-0.026}
          y1={-0.012}
          x2={0.024}
          y2={-0.012}
          stroke={sandal}
          strokeWidth={0.008}
        />
      </g>
    </g>
  );
}

function Arm({
  arm,
  style,
  far,
}: {
  arm: ArmPose;
  style: Style;
  far: boolean;
}) {
  const skin = far ? shade(style.skin, -0.18) : style.skin;
  const tunic = far ? shade(style.tunic, -0.18) : style.tunic;
  const sleeveEnd = {
    x: arm.shoulder.x + (arm.elbow.x - arm.shoulder.x) * 0.42,
    y: arm.shoulder.y + (arm.elbow.y - arm.shoulder.y) * 0.42,
  };
  const hand = {
    x: arm.wrist.x + sin(arm.hand) * 0.022,
    y: arm.wrist.y + cos(arm.hand) * 0.022,
  };
  return (
    <g>
      <Limb from={arm.shoulder} to={arm.elbow} width={0.048} color={skin} />
      <Limb from={arm.elbow} to={arm.wrist} width={0.042} color={skin} />
      <ellipse
        cx={hand.x}
        cy={hand.y}
        rx={0.02}
        ry={0.027}
        fill={skin}
        transform={`rotate(${-arm.hand * DEG} ${hand.x} ${hand.y})`}
      />
      <Limb from={arm.shoulder} to={sleeveEnd} width={0.07} color={tunic} />
    </g>
  );
}

function Torso({ pose, style }: { pose: Pose; style: Style }) {
  const { hips, lean, legs } = pose;
  const up = { x: sin(lean), y: -cos(lean) };
  const forward = { x: cos(lean), y: sin(lean) };
  const p = (along: number, across: number): Point => ({
    x: hips.x + up.x * along + forward.x * across,
    y: hips.y + up.y * along + forward.y * across,
  });
  // The skirt of the tunic hangs around the thighs and follows them.
  const thighs = legs.map((leg) => ({
    x: leg.hip.x + (leg.knee.x - leg.hip.x) * 0.8,
    y: leg.hip.y + (leg.knee.y - leg.hip.y) * 0.8,
  }));
  const hemY = max(...thighs.map((t) => t.y)) + 0.02;
  const front = max(...thighs.map((t) => t.x)) + 0.055 + pose.hem;
  const back = min(...thighs.map((t) => t.x)) - 0.06 + pose.hem;
  const neckBack = p(0.3, -0.03);
  const shoulderBack = p(0.27, -0.075);
  const waistBack = p(0.12, -0.08);
  const hipBack = p(0, -0.085);
  const neckFront = p(0.3, 0.03);
  const shoulderFront = p(0.265, 0.07);
  const chest = p(0.19, 0.088);
  const waistFront = p(0.11, 0.082);
  const hipFront = p(0, 0.085);
  const d = [
    `M ${at(neckBack)}`,
    `Q ${at(p(0.3, -0.07))} ${at(shoulderBack)}`,
    `L ${at(waistBack)}`,
    `L ${at(hipBack)}`,
    `L ${back} ${hemY - 0.01}`,
    `Q ${(back + front) / 2} ${hemY + 0.025} ${front} ${hemY - 0.005}`,
    `L ${at(hipFront)}`,
    `L ${at(waistFront)}`,
    `Q ${at(chest)} ${at(shoulderFront)}`,
    `Q ${at(p(0.3, 0.06))} ${at(neckFront)}`,
    "Z",
  ].join(" ");
  const hem = `M ${back} ${hemY - 0.01} Q ${(back + front) / 2} ${hemY + 0.025} ${front} ${hemY - 0.005}`;
  return (
    <g>
      <path d={d} fill={style.tunic} />
      <path d={hem} fill="none" stroke={style.trim} strokeWidth={0.012} />
      <Limb
        from={p(0.27, 0.04)}
        to={p(0.135, 0.05)}
        width={0.014}
        color={style.trim}
      />
      <Limb
        from={p(0.095, 0.052)}
        to={{ x: front - 0.045, y: hemY - 0.01 }}
        width={0.014}
        color={style.trim}
      />
      <Limb from={waistBack} to={waistFront} width={0.024} color={style.belt} />
    </g>
  );
}

function Head({ pose, style }: { pose: Pose; style: Style }) {
  const { face } = pose;
  const eyes = min(face.eyes, 1.5);
  const mouthOpen = face.mouth > 0.04;
  return (
    <g transform={`translate(${at(pose.neck)}) rotate(${pose.head * DEG})`}>
      <ellipse cx={0.012} cy={-0.075} rx={0.066} ry={0.074} fill={style.skin} />
      <ellipse
        cx={0.032}
        cy={-0.036}
        rx={0.046}
        ry={0.034 + 0.008 * face.mouth}
        fill={style.skin}
      />
      <path
        d="M 0.07 -0.094 L 0.09 -0.064 L 0.069 -0.058 Z"
        fill={shade(style.skin, -0.06)}
      />
      <ellipse
        cx={-0.01}
        cy={-0.072}
        rx={0.012}
        ry={0.017}
        fill={shade(style.skin, -0.12)}
      />
      <path
        d="M -0.056 -0.03 C -0.085 -0.12, -0.02 -0.168, 0.045 -0.147 C 0.074 -0.138, 0.084 -0.118, 0.078 -0.108 L 0.022 -0.12 C 0.002 -0.108, -0.016 -0.102, -0.026 -0.072 C -0.034 -0.05, -0.04 -0.04, -0.056 -0.03 Z"
        fill={style.hair}
      />
      <circle cx={0.03} cy={-0.058} r={0.014} fill="#e0806a" opacity={0.25} />
      {eyes > 0.22 ? (
        <g>
          <ellipse
            cx={0.045}
            cy={-0.088}
            rx={0.012 + 0.002 * max(0, eyes - 1)}
            ry={0.0105 * eyes}
            fill="#fbf7ef"
          />
          <circle
            cx={0.05}
            cy={-0.088}
            r={eyes > 1.2 ? 0.005 : 0.0065}
            fill="#2a1d17"
          />
        </g>
      ) : (
        <line
          x1={0.034}
          y1={-0.087}
          x2={0.057}
          y2={-0.087}
          stroke="#2a1d17"
          strokeWidth={0.004}
          strokeLinecap="round"
        />
      )}
      <line
        x1={0.031}
        y1={-0.105 - 0.013 * face.brows}
        x2={0.061}
        y2={-0.107 - 0.017 * face.brows + 0.004 * min(0, face.brows)}
        stroke={style.hair}
        strokeWidth={0.0075}
        strokeLinecap="round"
      />
      {mouthOpen ? (
        <ellipse
          cx={0.052}
          cy={-0.036 + 0.004 * face.mouth}
          rx={0.004 + 0.013 * (1 - 0.4 * face.round)}
          ry={0.003 + 0.017 * face.mouth}
          fill="#4a1c1c"
        />
      ) : (
        <path
          d="M 0.036 -0.039 Q 0.05 -0.036 0.062 -0.041"
          fill="none"
          stroke="#6b2b24"
          strokeWidth={0.005}
          strokeLinecap="round"
        />
      )}
    </g>
  );
}

export function CharacterView({
  character,
  pose,
}: {
  character: AnimationCharacter;
  pose: Pose;
}) {
  const { style } = character;
  const shoulderMid = {
    x: (pose.arms[0].shoulder.x + pose.arms[1].shoulder.x) / 2,
    y: (pose.arms[0].shoulder.y + pose.arms[1].shoulder.y) / 2 - 0.01,
  };
  return (
    <g
      transform={`translate(${pose.x} ${pose.y}) scale(${pose.facing * pose.height} ${pose.height})`}
    >
      <ellipse
        cx={pose.hips.x}
        cy={0.004}
        rx={0.17}
        ry={0.02}
        fill="#000000"
        opacity={0.16}
      />
      <Arm arm={pose.arms[1]} style={style} far />
      <Leg leg={pose.legs[1]} style={style} far />
      <Leg leg={pose.legs[0]} style={style} far={false} />
      <Limb from={shoulderMid} to={pose.neck} width={0.05} color={style.skin} />
      <Torso pose={pose} style={style} />
      <Head pose={pose} style={style} />
      <Arm arm={pose.arms[0]} style={style} far={false} />
    </g>
  );
}

/** A character drawn from pictures of its parts, placed on its skeleton. */
export function SpriteCharacterView({
  rig,
  pose,
  images,
  urls,
  farFilter,
}: {
  rig: SpriteRig;
  pose: Pose;
  images: AnimationSpec["images"];
  urls: Readonly<Record<string, string>>;
  /** An SVG filter that darkens the far side of the body. */
  farFilter: string;
}) {
  return (
    <g
      transform={`translate(${pose.x} ${pose.y}) scale(${pose.facing * pose.height} ${pose.height})`}
    >
      <ellipse
        cx={pose.hips.x}
        cy={0.004}
        rx={0.17}
        ry={0.02}
        fill="#000000"
        opacity={0.16}
      />
      {spriteOps(rig, pose).map((op, index) => {
        const image = images[op.image];
        const url = urls[op.image];
        if (!image || !url) return null;
        return (
          <image
            key={index}
            href={url}
            width={image.width}
            height={image.height}
            filter={op.far ? farFilter : undefined}
            transform={`translate(${op.x} ${op.y}) rotate(${(op.rotation * 180) / Math.PI}) scale(${op.scaleX} ${op.scaleY}) translate(${-op.pivot.x} ${-op.pivot.y})`}
          />
        );
      })}
    </g>
  );
}
