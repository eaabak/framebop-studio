/** @jsxRuntime automatic @jsxImportSource react */
/**
 * TEMPORARY TEST ART, made for Framebop by hand in SVG. It exists to test
 * sprite characters and painted layers; it is not production artwork.
 *
 * A Roman man ("Marcus") cut into parts for the sprite rig, drawn at 1000
 * pixels per unit of height: limbs hang straight down from their pivot,
 * torso and head stand upright, the foot is flat and faces right. Light
 * comes from the upper right.
 */
import type { ReactNode } from "react";

export interface ArtPiece {
  width: number;
  height: number;
  /** Joint the picture turns around, and the next joint along a limb. */
  pivot?: { x: number; y: number };
  tip?: { x: number; y: number };
  draw: () => ReactNode;
}

const INK = "#3a2216";
const SKIN = "#e2a47c";
const SKIN_DARK = "#c07a56";
const SKIN_LIGHT = "#f4c39d";
const TUNIC = "#b8432c";
const TUNIC_DARK = "#86291b";
const TUNIC_LIGHT = "#d9654a";
const TRIM = "#e9c46a";
const LEATHER = "#6b4226";
const LEATHER_DARK = "#43271a";
const HAIR = "#2a1a12";
const HAIR_LIGHT = "#5a3a26";
const LINE = {
  stroke: INK,
  strokeWidth: 5,
  strokeLinejoin: "round",
  strokeLinecap: "round",
} as const;

/** Light from the right: dark at the back of a limb, bright at the front. */
function Shade({
  id,
  dark,
  base,
  light,
}: {
  id: string;
  dark: string;
  base: string;
  light: string;
}) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stopColor={dark} />
      <stop offset="0.45" stopColor={base} />
      <stop offset="0.8" stopColor={light} />
      <stop offset="1" stopColor={base} />
    </linearGradient>
  );
}

const skinShade = (
  <Shade id="skin" dark={SKIN_DARK} base={SKIN} light={SKIN_LIGHT} />
);
const tunicShade = (
  <Shade id="tunic" dark={TUNIC_DARK} base={TUNIC} light={TUNIC_LIGHT} />
);

export const PARTS: Record<string, ArtPiece> = {
  "marcus-thigh": {
    width: 110,
    height: 326,
    pivot: { x: 55, y: 35 },
    tip: { x: 55, y: 290 },
    draw: () => (
      <>
        <defs>{skinShade}</defs>
        <path
          d="M 12 35 Q 12 4 55 4 Q 98 4 98 35 L 87 290 Q 86 318 55 318 Q 24 318 23 290 Z"
          fill="url(#skin)"
          {...LINE}
        />
      </>
    ),
  },
  "marcus-shin": {
    width: 90,
    height: 306,
    pivot: { x: 45, y: 30 },
    tip: { x: 45, y: 275 },
    draw: () => (
      <>
        <defs>{skinShade}</defs>
        <path
          d="M 15 30 Q 15 3 45 3 Q 76 3 76 30 L 72 120 Q 70 200 62 276 Q 60 300 45 300 Q 30 300 28 276 Q 14 192 8 112 Q 6 62 15 30 Z"
          fill="url(#skin)"
          {...LINE}
        />
        {[176, 206, 236, 264].map((y, i) => (
          <path
            key={y}
            d={`M ${i % 2 ? 66 : 22} ${y} L ${i % 2 ? 24 : 64} ${y + 22}`}
            stroke={LEATHER}
            strokeWidth={7}
            strokeLinecap="round"
          />
        ))}
      </>
    ),
  },
  "marcus-foot": {
    width: 176,
    height: 80,
    // The sole is 35 px under the ankle, the heel 32 px behind and the toe
    // 88 px ahead, matching the rig's foot.
    pivot: { x: 55, y: 37 },
    draw: () => (
      <g transform="translate(17 0) scale(0.75 1)">
        <defs>{skinShade}</defs>
        <path
          d="M 12 58 L 162 58 Q 170 60 168 66 Q 166 72 156 72 L 18 72 Q 8 72 8 64 Q 8 58 12 58 Z"
          fill={LEATHER_DARK}
          {...LINE}
          strokeWidth={4}
        />
        <path
          d="M 28 6 Q 62 -2 72 22 Q 102 30 138 40 Q 162 46 160 58 L 18 58 Q 8 56 10 38 Q 12 16 28 6 Z"
          fill="url(#skin)"
          {...LINE}
        />
        <path
          d="M 72 26 Q 80 44 76 58"
          stroke={LEATHER}
          strokeWidth={9}
          fill="none"
        />
        <path
          d="M 120 36 Q 126 48 124 58"
          stroke={LEATHER}
          strokeWidth={7}
          fill="none"
        />
        <path
          d="M 30 12 Q 46 20 70 22"
          stroke={LEATHER}
          strokeWidth={8}
          fill="none"
        />
        {[142, 150].map((x) => (
          <path
            key={x}
            d={`M ${x} 46 Q ${x + 4} 52 ${x + 2} 57`}
            stroke={SKIN_DARK}
            strokeWidth={2.5}
            fill="none"
          />
        ))}
      </g>
    ),
  },
  "marcus-upper-arm": {
    width: 92,
    height: 226,
    pivot: { x: 46, y: 30 },
    tip: { x: 46, y: 195 },
    draw: () => (
      <>
        <defs>
          {skinShade}
          {tunicShade}
        </defs>
        <path
          d="M 20 40 Q 20 6 46 6 Q 72 6 72 40 L 68 195 Q 66 220 46 220 Q 26 220 24 195 Z"
          fill="url(#skin)"
          {...LINE}
        />
        <path
          d="M 6 32 Q 6 0 46 0 Q 86 0 86 32 L 84 104 Q 46 116 8 104 Z"
          fill="url(#tunic)"
          {...LINE}
        />
        <path
          d="M 9 98 Q 46 110 83 98"
          stroke={TRIM}
          strokeWidth={7}
          fill="none"
        />
        <path
          d="M 30 30 Q 36 62 32 92"
          stroke={TUNIC_DARK}
          strokeWidth={4}
          fill="none"
          opacity={0.7}
        />
      </>
    ),
  },
  "marcus-forearm": {
    width: 80,
    height: 206,
    pivot: { x: 40, y: 28 },
    tip: { x: 40, y: 178 },
    draw: () => (
      <>
        <defs>{skinShade}</defs>
        <path
          d="M 14 28 Q 14 4 40 4 Q 66 4 66 28 L 58 178 Q 56 200 40 200 Q 24 200 22 178 Z"
          fill="url(#skin)"
          {...LINE}
        />
        <path
          d="M 18 130 L 62 130 L 59 176 L 21 176 Z"
          fill={LEATHER}
          {...LINE}
          strokeWidth={4}
        />
        <path
          d="M 22 142 L 60 142 M 23 164 L 58 164"
          stroke={LEATHER_DARK}
          strokeWidth={3}
          strokeDasharray="5 5"
        />
      </>
    ),
  },
  "marcus-hand": {
    width: 84,
    height: 96,
    pivot: { x: 40, y: 18 },
    draw: () => (
      <>
        <defs>{skinShade}</defs>
        <ellipse
          cx={62}
          cy={42}
          rx={11}
          ry={20}
          transform="rotate(-20 62 42)"
          fill="url(#skin)"
          {...LINE}
        />
        <path
          d="M 20 12 Q 40 2 58 12 L 62 54 Q 62 86 40 90 Q 20 88 18 60 Z"
          fill="url(#skin)"
          {...LINE}
        />
        <path
          d="M 28 62 L 30 80 M 40 64 L 40 84 M 51 62 L 50 79"
          stroke={SKIN_DARK}
          strokeWidth={3}
          strokeLinecap="round"
        />
      </>
    ),
  },
  "marcus-torso": {
    width: 240,
    height: 400,
    pivot: { x: 115, y: 360 },
    draw: () => (
      <>
        <defs>
          {skinShade}
          {tunicShade}
        </defs>
        <path
          d="M 100 14 L 146 14 L 150 86 L 98 86 Z"
          fill="url(#skin)"
          {...LINE}
        />
        <path
          d="M 96 72 Q 70 76 44 94 Q 30 104 32 132 L 34 242 L 30 376 L 202 376 L 200 242 Q 214 196 206 150 Q 200 104 184 92 Q 166 76 152 72 Q 124 88 96 72 Z"
          fill="url(#tunic)"
          {...LINE}
        />
        <path
          d="M 98 74 Q 124 92 152 74"
          stroke={TRIM}
          strokeWidth={6}
          fill="none"
        />
        <path
          d="M 172 86 Q 182 160 178 236"
          stroke={TRIM}
          strokeWidth={11}
          fill="none"
        />
        <path
          d="M 60 112 Q 74 170 66 230 M 120 120 Q 132 176 124 232"
          stroke={TUNIC_DARK}
          strokeWidth={5}
          fill="none"
          opacity={0.55}
        />
        <path
          d="M 150 104 Q 168 130 166 160"
          stroke={TUNIC_LIGHT}
          strokeWidth={6}
          fill="none"
          opacity={0.7}
        />
        <path
          d="M 30 234 Q 116 250 204 234 L 204 262 Q 116 278 30 262 Z"
          fill={LEATHER}
          {...LINE}
          strokeWidth={4}
        />
        <rect
          x={180}
          y={236}
          width={22}
          height={26}
          rx={4}
          fill="#d4a843"
          {...LINE}
          strokeWidth={3}
        />
      </>
    ),
  },
  "marcus-skirt": {
    // Reaches up under the belt, with no outline along its top, so it
    // joins the torso without a seam.
    width: 260,
    height: 360,
    pivot: { x: 115, y: 104 },
    draw: () => (
      <>
        <defs>{tunicShade}</defs>
        <path
          d="M 42 10 L 190 10 Q 214 170 236 314 Q 182 338 120 332 Q 56 338 6 314 Q 26 170 42 10 Z"
          fill="url(#tunic)"
        />
        <path
          d="M 42 10 Q 26 170 6 314 Q 56 338 120 332 Q 182 338 236 314 Q 214 170 190 10"
          fill="none"
          {...LINE}
        />
        <path
          d="M 9 302 Q 60 324 120 318 Q 182 324 233 302"
          stroke={TRIM}
          strokeWidth={10}
          fill="none"
        />
        {[64, 102, 144, 182].map((x, i) => (
          <path
            key={x}
            d={`M ${x} 110 Q ${x + (i % 2 ? 8 : -8)} 210 ${x + (x - 120) * 0.25} 306`}
            stroke={i < 2 ? TUNIC_DARK : TUNIC_LIGHT}
            strokeWidth={5}
            fill="none"
            opacity={0.6}
          />
        ))}
      </>
    ),
  },
  "marcus-head": {
    width: 240,
    height: 250,
    pivot: { x: 100, y: 232 },
    draw: () => (
      <>
        <defs>
          <radialGradient id="face" cx="0.62" cy="0.45" r="0.6">
            <stop offset="0" stopColor={SKIN_LIGHT} />
            <stop offset="0.6" stopColor={SKIN} />
            <stop offset="1" stopColor={SKIN_DARK} />
          </radialGradient>
        </defs>
        <path
          d="M 64 222 Q 34 186 38 140 Q 42 60 104 44 Q 168 36 184 92 Q 188 106 186 112 Q 204 128 206 140 Q 206 150 190 152 Q 192 164 190 172 Q 186 180 184 186 Q 182 210 156 222 Q 130 232 118 244 L 70 244 Z"
          fill="url(#face)"
          {...LINE}
        />
        <ellipse
          cx={170}
          cy={168}
          rx={18}
          ry={11}
          fill="#e0806a"
          opacity={0.35}
        />
        <ellipse
          cx={92}
          cy={136}
          rx={17}
          ry={25}
          fill={SKIN}
          {...LINE}
          strokeWidth={4}
        />
        <path
          d="M 90 124 Q 100 136 92 150"
          stroke={SKIN_DARK}
          strokeWidth={4}
          fill="none"
        />
        {[
          [52, 186, 20],
          [44, 156, 23],
          [46, 122, 24],
          [58, 90, 25],
          [80, 64, 26],
          [110, 50, 26],
          [140, 46, 24],
          [166, 56, 21],
          [182, 74, 15],
          [70, 116, 18],
          [96, 84, 20],
          [126, 72, 18],
        ].map(([x, y, r], i) => (
          <g key={i}>
            <circle cx={x} cy={y} r={r} fill={HAIR} {...LINE} strokeWidth={4} />
            <path
              d={`M ${x! - r! * 0.4} ${y! - r! * 0.35} Q ${x} ${y! - r! * 0.7} ${x! + r! * 0.45} ${y! - r! * 0.3}`}
              stroke={HAIR_LIGHT}
              strokeWidth={4}
              fill="none"
            />
          </g>
        ))}
        <path
          d="M 108 150 Q 112 174 104 194"
          stroke={HAIR}
          strokeWidth={9}
          strokeLinecap="round"
        />
      </>
    ),
  },
  "marcus-eye-open": {
    width: 64,
    height: 56,
    pivot: { x: 32, y: 30 },
    draw: () => (
      <>
        <ellipse
          cx={32}
          cy={32}
          rx={13}
          ry={15}
          fill="#fbf7ef"
          {...LINE}
          strokeWidth={3.5}
        />
        <circle cx={37} cy={33} r={8} fill="#4a2a18" />
        <circle cx={38} cy={33} r={4} fill="#120a06" />
        <circle cx={40} cy={29} r={2.5} fill="#ffffff" />
        <path
          d="M 19 26 Q 32 14 46 24"
          stroke={INK}
          strokeWidth={4}
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 16 10 Q 32 2 50 8"
          stroke={HAIR}
          strokeWidth={7}
          fill="none"
          strokeLinecap="round"
        />
      </>
    ),
  },
  "marcus-eye-closed": {
    width: 64,
    height: 56,
    pivot: { x: 32, y: 30 },
    draw: () => (
      <>
        <path
          d="M 19 32 Q 32 40 46 32"
          stroke={INK}
          strokeWidth={4}
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 16 12 Q 32 6 50 10"
          stroke={HAIR}
          strokeWidth={7}
          fill="none"
          strokeLinecap="round"
        />
      </>
    ),
  },
  "marcus-eye-wide": {
    width: 64,
    height: 56,
    pivot: { x: 32, y: 30 },
    draw: () => (
      <>
        <ellipse
          cx={32}
          cy={32}
          rx={15}
          ry={19}
          fill="#fbf7ef"
          {...LINE}
          strokeWidth={3.5}
        />
        <circle cx={35} cy={33} r={6} fill="#4a2a18" />
        <circle cx={36} cy={33} r={3} fill="#120a06" />
        <circle cx={38} cy={30} r={2} fill="#ffffff" />
        <path
          d="M 14 6 Q 32 -4 52 4"
          stroke={HAIR}
          strokeWidth={7}
          fill="none"
          strokeLinecap="round"
        />
      </>
    ),
  },
  "marcus-mouth-closed": {
    width: 64,
    height: 48,
    pivot: { x: 32, y: 24 },
    draw: () => (
      <>
        <path
          d="M 16 24 Q 32 30 46 22"
          stroke="#7a2e24"
          strokeWidth={4.5}
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 24 32 Q 32 35 40 32"
          stroke={SKIN_DARK}
          strokeWidth={3}
          fill="none"
          strokeLinecap="round"
        />
      </>
    ),
  },
  "marcus-mouth-small": {
    width: 64,
    height: 48,
    pivot: { x: 32, y: 24 },
    draw: () => (
      <ellipse
        cx={32}
        cy={25}
        rx={10}
        ry={7}
        fill="#5a1a1a"
        stroke="#7a2e24"
        strokeWidth={3.5}
      />
    ),
  },
  "marcus-mouth-wide": {
    width: 64,
    height: 48,
    pivot: { x: 32, y: 24 },
    draw: () => (
      <>
        <path
          d="M 14 18 Q 32 14 50 18 Q 48 42 32 42 Q 16 42 14 18 Z"
          fill="#5a1a1a"
          stroke="#7a2e24"
          strokeWidth={3.5}
          strokeLinejoin="round"
        />
        <path
          d="M 18 19 Q 32 16 46 19 L 45 24 Q 32 22 19 24 Z"
          fill="#fbf7ef"
        />
        <ellipse cx={32} cy={36} rx={9} ry={4} fill="#d9707a" />
      </>
    ),
  },
  "marcus-mouth-round": {
    width: 64,
    height: 48,
    pivot: { x: 32, y: 24 },
    draw: () => (
      <ellipse
        cx={32}
        cy={25}
        rx={9}
        ry={13}
        fill="#5a1a1a"
        stroke="#7a2e24"
        strokeWidth={4}
      />
    ),
  },
};
