/** @jsxRuntime automatic @jsxImportSource react */
/**
 * TEMPORARY TEST ART, made for Framebop by hand in SVG: painted layers of a
 * Roman street for the PixiJS proof. Not production artwork. Texture and
 * soft shadows are baked in once, so they cost nothing per frame.
 */
import type { ReactNode } from "react";
import type { ArtPiece } from "./parts";

/** A repeatable random sequence, so the same art is baked every time. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Fine grain and soft blotches, like paint on plaster. */
const Grain = ({
  id,
  strength = 0.18,
  scale = 0.9,
}: {
  id: string;
  strength?: number;
  scale?: number;
}) => (
  <filter id={id} x="0" y="0" width="100%" height="100%">
    <feTurbulence
      type="fractalNoise"
      baseFrequency={scale}
      numOctaves={2}
      seed={4}
      result="fine"
    />
    <feTurbulence
      type="fractalNoise"
      baseFrequency={0.012}
      numOctaves={3}
      seed={9}
      result="broad"
    />
    <feColorMatrix
      in="fine"
      type="matrix"
      values={`0 0 0 0 0.2  0 0 0 0 0.12  0 0 0 0 0.06  0 0 0 ${strength} 0`}
      result="fineInk"
    />
    <feColorMatrix
      in="broad"
      type="matrix"
      values={`0 0 0 0 0.3  0 0 0 0 0.18  0 0 0 0 0.08  0 0 0 ${strength * 1.4} -0.05`}
      result="broadInk"
    />
    <feComposite in="fineInk" in2="SourceGraphic" operator="in" result="a" />
    <feComposite in="broadInk" in2="SourceGraphic" operator="in" result="b" />
    <feMerge>
      <feMergeNode in="SourceGraphic" />
      <feMergeNode in="b" />
      <feMergeNode in="a" />
    </feMerge>
  </filter>
);

const Soft = ({ id, blur }: { id: string; blur: number }) => (
  <filter id={id} x="-20%" y="-20%" width="140%" height="140%">
    <feGaussianBlur stdDeviation={blur} />
  </filter>
);

function Cypress({
  x,
  y,
  h,
  color,
}: {
  x: number;
  y: number;
  h: number;
  color: string;
}) {
  return (
    <path
      d={`M ${x} ${y} C ${x - h * 0.13} ${y - h * 0.3}, ${x - h * 0.09} ${y - h * 0.75}, ${x} ${y - h} C ${x + h * 0.09} ${y - h * 0.75}, ${x + h * 0.13} ${y - h * 0.3}, ${x} ${y} Z`}
      fill={color}
    />
  );
}

function StonePine({
  x,
  y,
  h,
  color,
  light,
}: {
  x: number;
  y: number;
  h: number;
  color: string;
  light: string;
}) {
  return (
    <g>
      <path
        d={`M ${x} ${y} L ${x - 4} ${y - h * 0.7} M ${x} ${y - h * 0.55} L ${x + h * 0.12} ${y - h * 0.75}`}
        stroke="#5a4636"
        strokeWidth={h * 0.05}
      />
      <ellipse
        cx={x + h * 0.04}
        cy={y - h * 0.82}
        rx={h * 0.42}
        ry={h * 0.16}
        fill={color}
      />
      <ellipse
        cx={x + h * 0.12}
        cy={y - h * 0.88}
        rx={h * 0.26}
        ry={h * 0.08}
        fill={light}
      />
    </g>
  );
}

function Window({
  x,
  y,
  w,
  h,
  shutter,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  shutter: string | null;
}) {
  return (
    <g>
      <rect x={x - 3} y={y - 3} width={w + 6} height={h + 8} fill="#e8d6b4" />
      <rect x={x} y={y} width={w} height={h} fill="#2b1d16" />
      <rect x={x} y={y} width={w} height={h * 0.35} fill="#1a110c" />
      {shutter && (
        <>
          <rect
            x={x - w * 0.55}
            y={y}
            width={w * 0.5}
            height={h}
            fill={shutter}
          />
          <rect
            x={x + w * 1.05}
            y={y}
            width={w * 0.5}
            height={h}
            fill={shutter}
          />
        </>
      )}
      <rect x={x - 6} y={y + h + 4} width={w + 12} height={6} fill="#c9b18c" />
    </g>
  );
}

/** A tiled roof seen from the street, with its shadow on the wall. */
function Roof({
  x,
  y,
  w,
  color,
}: {
  x: number;
  y: number;
  w: number;
  color: string;
}) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={26} fill="#000000" opacity={0.16} />
      <path
        d={`M ${x - 18} ${y} L ${x + w + 18} ${y} L ${x + w + 4} ${y - 34} L ${x - 4} ${y - 34} Z`}
        fill={color}
      />
      {Array.from({ length: Math.floor(w / 22) }, (_, i) => (
        <path
          key={i}
          d={`M ${x + i * 22} ${y - 2} L ${x + i * 22 + 6} ${y - 32}`}
          stroke="#00000030"
          strokeWidth={3}
        />
      ))}
      <rect x={x - 18} y={y - 4} width={w + 36} height={6} fill="#00000025" />
    </g>
  );
}

function Building({
  x,
  base,
  w,
  h,
  color,
  roof,
  rng,
  shop,
}: {
  x: number;
  base: number;
  w: number;
  h: number;
  color: string;
  roof: string;
  rng: () => number;
  shop: boolean;
}) {
  const top = base - h;
  const floors = Math.max(1, Math.round((h - 120) / 130));
  const columns = Math.max(1, Math.round(w / 120));
  const windows: ReactNode[] = [];
  for (let f = 0; f < floors; f += 1) {
    for (let c = 0; c < columns; c += 1) {
      if (rng() < 0.18) continue;
      const wx = x + ((c + 0.5) * w) / columns - 20;
      const wy = top + 50 + f * 130;
      windows.push(
        <Window
          key={`${f}-${c}`}
          x={wx}
          y={wy}
          w={40}
          h={56}
          shutter={rng() < 0.5 ? (rng() < 0.5 ? "#6e8a5e" : "#8a5a3a") : null}
        />,
      );
    }
  }
  return (
    <g>
      <rect
        x={x}
        y={top}
        width={w}
        height={h}
        fill={color}
        filter="url(#plaster)"
      />
      <rect
        x={x}
        y={top}
        width={w * 0.12}
        height={h}
        fill="#000000"
        opacity={0.08}
      />
      <rect
        x={x}
        y={base - 70}
        width={w}
        height={70}
        fill="#000000"
        opacity={0.07}
      />
      {windows}
      {shop && (
        <g>
          <path
            d={`M ${x + w * 0.2} ${base} L ${x + w * 0.2} ${base - 150} Q ${x + w * 0.5} ${base - 215} ${x + w * 0.8} ${base - 150} L ${x + w * 0.8} ${base} Z`}
            fill="#24170f"
          />
          <rect
            x={x + w * 0.22}
            y={base - 70}
            width={w * 0.56}
            height={70}
            fill="#7a5032"
          />
          <rect
            x={x + w * 0.22}
            y={base - 74}
            width={w * 0.56}
            height={10}
            fill="#5a3a24"
          />
          {[0.3, 0.42, 0.58, 0.7].map((f, i) => (
            <ellipse
              key={f}
              cx={x + w * f}
              cy={base - 84}
              rx={14}
              ry={12}
              fill={["#b8653d", "#7a3d5a", "#c99a3a", "#5c8a4a"][i]}
            />
          ))}
        </g>
      )}
      <Roof x={x} y={top} w={w} color={roof} />
    </g>
  );
}

function Awning({
  x,
  y,
  w,
  colors,
}: {
  x: number;
  y: number;
  w: number;
  colors: [string, string];
}) {
  const stripes = Math.round(w / 46);
  return (
    <g>
      <path
        d={`M ${x} ${y} L ${x + w} ${y} L ${x + w + 20} ${y + 70} L ${x - 20} ${y + 70} Z`}
        fill="#000"
        opacity={0.18}
        transform="translate(8 26)"
        filter="url(#soft8)"
      />
      {Array.from({ length: stripes }, (_, i) => {
        const a = x + (i * w) / stripes;
        const b = x + ((i + 1) * w) / stripes;
        const spread = (u: number) => x - 20 + ((u - x) / w) * (w + 40);
        return (
          <path
            key={i}
            d={`M ${a} ${y} L ${b} ${y} L ${spread(b)} ${y + 70} Q ${(spread(a) + spread(b)) / 2} ${y + 84} ${spread(a)} ${y + 70} Z`}
            fill={colors[i % 2]}
          />
        );
      })}
      <path
        d={`M ${x} ${y} L ${x + w + 20} ${y + 70}`}
        stroke="#00000020"
        strokeWidth={2}
      />
    </g>
  );
}

export const PLATES: Record<string, ArtPiece> = {
  "street-sky": {
    width: 1920,
    height: 1080,
    draw: () => (
      <>
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#6fa6d6" />
            <stop offset="0.55" stopColor="#bcd8ea" />
            <stop offset="0.85" stopColor="#f3dfbe" />
            <stop offset="1" stopColor="#f6d9a8" />
          </linearGradient>
          <radialGradient id="sun" cx="0.78" cy="0.3" r="0.45">
            <stop offset="0" stopColor="#fff6dc" stopOpacity={0.95} />
            <stop offset="0.25" stopColor="#ffeec4" stopOpacity={0.45} />
            <stop offset="1" stopColor="#ffeec4" stopOpacity={0} />
          </radialGradient>
        </defs>
        <rect width={1920} height={1080} fill="url(#sky)" />
        <rect width={1920} height={1080} fill="url(#sun)" />
      </>
    ),
  },
  "street-cloud": {
    width: 460,
    height: 190,
    draw: () => (
      <>
        <defs>
          <Soft id="soft3" blur={3} />
          <linearGradient id="cloud" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.7" stopColor="#f3eee8" />
            <stop offset="1" stopColor="#d9d2d6" />
          </linearGradient>
        </defs>
        <g filter="url(#soft3)" fill="url(#cloud)">
          <ellipse cx={230} cy={130} rx={210} ry={44} />
          <ellipse cx={150} cy={100} rx={90} ry={62} />
          <ellipse cx={260} cy={82} rx={110} ry={72} />
          <ellipse cx={350} cy={112} rx={80} ry={50} />
        </g>
        <ellipse
          cx={250}
          cy={62}
          rx={70}
          ry={24}
          fill="#ffffff"
          opacity={0.7}
          filter="url(#soft3)"
        />
      </>
    ),
  },
  "street-bird": {
    width: 60,
    height: 30,
    draw: () => (
      <path
        d="M 4 18 Q 16 4 30 18 Q 44 4 56 18 Q 44 12 30 22 Q 16 12 4 18 Z"
        fill="#3e352e"
      />
    ),
  },
  "street-far": {
    width: 2600,
    height: 520,
    draw: () => {
      const rng = random(11);
      return (
        <>
          <defs>
            <linearGradient id="haze" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#f3e3c6" stopOpacity={0} />
              <stop offset="1" stopColor="#f3e3c6" stopOpacity={0.55} />
            </linearGradient>
            <linearGradient id="marble" x1="1" y1="0" x2="0" y2="0">
              <stop offset="0" stopColor="#fbf3e2" />
              <stop offset="1" stopColor="#d9cbb2" />
            </linearGradient>
          </defs>
          <path
            d="M 0 520 L 0 330 Q 300 250 620 300 Q 900 220 1250 270 Q 1600 180 1950 260 Q 2300 230 2600 290 L 2600 520 Z"
            fill="#a9bba8"
          />
          <path
            d="M 0 520 L 0 400 Q 400 330 820 380 Q 1100 260 1400 250 Q 1700 300 2000 360 Q 2300 330 2600 380 L 2600 520 Z"
            fill="#8fa58a"
          />
          {Array.from({ length: 26 }, (_, i) => {
            const x = 80 + i * 98 + rng() * 40;
            return (
              <Cypress
                key={i}
                x={x}
                y={430 + rng() * 40}
                h={90 + rng() * 70}
                color="#5d7660"
              />
            );
          })}
          <g transform="translate(1270 268)">
            <rect x={-170} y={-24} width={340} height={24} fill="#cbbd9f" />
            <rect
              x={-150}
              y={-38}
              width={300}
              height={14}
              fill="url(#marble)"
            />
            {Array.from({ length: 8 }, (_, i) => (
              <rect
                key={i}
                x={-136 + i * 37}
                y={-150}
                width={18}
                height={112}
                fill="url(#marble)"
              />
            ))}
            <rect x={-156} y={-168} width={312} height={20} fill="#e8dcc4" />
            <path d="M -164 -168 L 0 -226 L 164 -168 Z" fill="#c9a77a" />
            <path d="M -130 -172 L 0 -214 L 130 -172 Z" fill="#efe4cc" />
            <rect
              x={-150}
              y={-150}
              width={300}
              height={112}
              fill="#000"
              opacity={0.06}
            />
          </g>
          <rect width={2600} height={520} fill="url(#haze)" />
        </>
      );
    },
  },
  "street-mid": {
    width: 3000,
    height: 560,
    draw: () => {
      const rng = random(23);
      const items: ReactNode[] = [];
      let x = 0;
      let i = 0;
      while (x < 3000) {
        const w = 180 + rng() * 140;
        const h = 240 + rng() * 220;
        const colors = ["#e3c79e", "#d8b088", "#ecd6b2", "#cf9f78"];
        items.push(
          <Building
            key={i}
            x={x}
            base={560}
            w={w}
            h={h}
            color={colors[i % 4]!}
            roof={i % 2 ? "#b8674b" : "#a85a40"}
            rng={rng}
            shop={false}
          />,
        );
        if (rng() < 0.35)
          items.push(
            <StonePine
              key={`p${i}`}
              x={x + w}
              y={560 - h * 0.4}
              h={180 + rng() * 60}
              color="#5f7a52"
              light="#7c9868"
            />,
          );
        x += w + (rng() < 0.2 ? 30 : 0);
        i += 1;
      }
      return (
        <>
          <defs>
            <Grain id="plaster" strength={0.12} />
            <linearGradient id="haze2" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#f6e6c8" stopOpacity={0.25} />
              <stop offset="1" stopColor="#f6e6c8" stopOpacity={0.4} />
            </linearGradient>
          </defs>
          <g transform="translate(0 0)">
            {/* An aqueduct crossing behind the houses. */}
            <g fill="#d6c19c">
              <rect x={600} y={170} width={1500} height={40} />
              {Array.from({ length: 12 }, (_, k) => (
                <path
                  key={k}
                  d={`M ${600 + k * 125} 210 L ${600 + k * 125} 460 L ${625 + k * 125} 460 L ${625 + k * 125} 280 Q ${662 + k * 125} 230 ${700 + k * 125} 280 L ${700 + k * 125} 460 L ${725 + k * 125} 460 L ${725 + k * 125} 210 Z`}
                />
              ))}
            </g>
          </g>
          {items}
          <rect width={3000} height={560} fill="url(#haze2)" />
        </>
      );
    },
  },
  "street-facade": {
    width: 3400,
    height: 780,
    draw: () => {
      const rng = random(37);
      const items: ReactNode[] = [];
      let x = 0;
      let i = 0;
      const colors = ["#d9a46f", "#c98f5c", "#e5bd8c", "#cf9a68", "#e0b07a"];
      while (x < 3400) {
        const w = 360 + rng() * 160;
        const h = 400 + rng() * 150;
        items.push(
          <Building
            key={i}
            x={x}
            base={780}
            w={w}
            h={h}
            color={colors[i % 5]!}
            roof={i % 2 ? "#9c4a32" : "#a8553a"}
            rng={rng}
            shop={i % 2 === 0}
          />,
        );
        if (i % 2 === 0)
          items.push(
            <Awning
              key={`a${i}`}
              x={x + w * 0.16}
              y={780 - 230}
              w={w * 0.68}
              colors={i % 4 ? ["#c0392b", "#f1e3c6"] : ["#3d6b8f", "#f1e3c6"]}
            />,
          );
        x += w;
        i += 1;
      }
      return (
        <>
          <defs>
            <Grain id="plaster" strength={0.2} />
            <Soft id="soft8" blur={8} />
          </defs>
          {items}
          {/* Morning light across the facades, and shade near the ground. */}
          <defs>
            <linearGradient id="light" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#fff2d6" stopOpacity={0.18} />
              <stop offset="0.7" stopColor="#fff2d6" stopOpacity={0} />
              <stop offset="1" stopColor="#3a2416" stopOpacity={0.22} />
            </linearGradient>
          </defs>
          <rect width={3400} height={780} fill="url(#light)" />
        </>
      );
    },
  },
  "street-ground": {
    width: 3400,
    height: 340,
    draw: () => {
      const rng = random(51);
      const stones: ReactNode[] = [];
      // Rows of basalt blocks, larger towards the viewer.
      let y = 40;
      let row = 0;
      while (y < 340) {
        const h = 26 + row * 12;
        let x = -rng() * 80;
        while (x < 3400) {
          const w = h * (1.4 + rng() * 1.2);
          const shade = 70 + Math.floor(rng() * 30);
          const fill = `rgb(${shade + 40},${shade + 30},${shade + 22})`;
          const j = () => (rng() - 0.5) * h * 0.25;
          stones.push(
            <path
              key={`${row}-${Math.round(x)}`}
              d={`M ${x + 4 + j()} ${y + 3} L ${x + w - 4 + j()} ${y + 3 + j() * 0.3} L ${x + w - 2} ${y + h - 3} L ${x + 2} ${y + h - 3 + j() * 0.3} Z`}
              fill={fill}
              stroke="#3e352c"
              strokeWidth={3}
              strokeLinejoin="round"
            />,
          );
          stones.push(
            <path
              key={`h${row}-${Math.round(x)}`}
              d={`M ${x + 8} ${y + 6} L ${x + w * 0.6} ${y + 6}`}
              stroke="#ffffff"
              strokeOpacity={0.12}
              strokeWidth={3}
            />,
          );
          x += w;
        }
        y += h;
        row += 1;
      }
      return (
        <>
          <defs>
            <Grain id="stone" strength={0.25} scale={1.2} />
            <linearGradient id="curb" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#cdb898" />
              <stop offset="1" stopColor="#b39d7c" />
            </linearGradient>
            <linearGradient id="wallShade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#2a1c12" stopOpacity={0.35} />
              <stop offset="0.35" stopColor="#2a1c12" stopOpacity={0} />
            </linearGradient>
          </defs>
          <rect width={3400} height={340} fill="#6f655a" />
          <g filter="url(#stone)">{stones}</g>
          <rect y={0} width={3400} height={42} fill="url(#curb)" />
          <rect y={40} width={3400} height={6} fill="#5a4a3a" />
          <rect width={3400} height={340} fill="url(#wallShade)" />
        </>
      );
    },
  },
  "street-column": {
    width: 260,
    height: 1300,
    draw: () => (
      <>
        <defs>
          <linearGradient id="col" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#9c917e" />
            <stop offset="0.35" stopColor="#d9cfbc" />
            <stop offset="0.75" stopColor="#f4ecdc" />
            <stop offset="1" stopColor="#c4b8a2" />
          </linearGradient>
        </defs>
        <rect x={20} y={1240} width={220} height={60} fill="#b8ab94" />
        <rect x={40} y={60} width={180} height={1180} fill="url(#col)" />
        {[70, 100, 130, 160, 190].map((x) => (
          <line
            key={x}
            x1={x}
            y1={70}
            x2={x}
            y2={1230}
            stroke="#8f8470"
            strokeOpacity={0.35}
            strokeWidth={6}
          />
        ))}
        <rect x={10} y={0} width={240} height={70} fill="#d6cbb6" />
      </>
    ),
  },
  "street-plant": {
    width: 520,
    height: 560,
    draw: () => {
      const rng = random(77);
      return (
        <>
          {Array.from({ length: 14 }, (_, i) => {
            const angle = -80 + i * 12 + rng() * 6;
            const length = 230 + rng() * 120;
            return (
              <ellipse
                key={i}
                cx={0}
                cy={-length / 2}
                rx={34}
                ry={length / 2}
                fill={
                  i % 3 === 0 ? "#3f6b34" : i % 3 === 1 ? "#4f8040" : "#5f9450"
                }
                transform={`translate(260 330) rotate(${angle})`}
              />
            );
          })}
          <path d="M 150 340 L 370 340 L 340 560 L 180 560 Z" fill="#b0603a" />
          <rect x={136} y={322} width={248} height={30} rx={8} fill="#96502f" />
        </>
      );
    },
  },
};
