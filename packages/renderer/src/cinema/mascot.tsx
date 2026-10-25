/**
 * The Framebop mascot from the app's icon, as an SVG figure that can watch,
 * blink and hop. It keeps the brand's character in every video.
 */
import { ART } from "../brand/logoArt";
import { clamp } from "../animation/timing";

/**
 * The Framebop mascot, from the app's icon. `look` turns the eyes (-1..1),
 * `blink` closes them (0 open, 1 shut), `hop` lifts it, in its own heights.
 */
export function Mascot({
  id,
  x,
  y,
  size,
  look,
  blink,
  hop,
  sway,
  ground = true,
}: {
  id: string;
  x: number;
  /** Where it stands. */
  y: number;
  size: number;
  look: number;
  blink: number;
  hop: number;
  sway: number;
  /** Its small contact shadow on the ground. */
  ground?: boolean;
}) {
  const open = 1 - clamp(blink) * 0.9;
  const top = y - size * (1 + hop * 0.25);
  return (
    <g>
      {ground && (
        <ellipse
          cx={x}
          cy={y}
          rx={size * 0.42 * (1 - hop * 0.3)}
          ry={size * 0.06}
          fill="#000"
          fillOpacity={0.45}
        />
      )}
      <svg
        x={x - size / 2}
        y={top}
        width={size}
        height={size}
        viewBox="51 51 920 920"
      >
        <defs>
          <linearGradient
            id={`${id}mbody`}
            gradientUnits="userSpaceOnUse"
            x1="657"
            y1="821"
            x2="389"
            y2="290"
          >
            <stop offset="0" stopColor="#FE590A" />
            <stop offset="1" stopColor="#FDA624" />
          </linearGradient>
          <linearGradient
            id={`${id}mleaf`}
            gradientUnits="userSpaceOnUse"
            x1="788"
            y1="379"
            x2="825"
            y2="269"
          >
            <stop offset="0" stopColor="#FD7704" />
            <stop offset="1" stopColor="#FEBB3C" />
          </linearGradient>
          <clipPath id={`${id}mscreen`}>
            <path d={ART.screen} />
          </clipPath>
        </defs>
        <path d={ART.body} fill={`url(#${id}mbody)`} />
        <path d={ART.rim} fill="#FDEBC0" fillOpacity={0.75} />
        <path d={ART.frame} fill="#FBF3E4" />
        <path d={ART.screen} fill="#212021" />
        <g clipPath={`url(#${id}mscreen)`}>
          <g transform={`translate(${clamp(look, -1, 1) * 22} 0)`}>
            <g transform={`translate(0 ${560 * (1 - open)}) scale(1 ${open})`}>
              <path d={ART.eyeLeft} fill="#FBF3E4" />
              <path d={ART.eyeRight} fill="#FBF3E4" />
            </g>
          </g>
        </g>
        <g transform={`rotate(${sway} 790 330)`}>
          <path d={ART.leaf} fill={`url(#${id}mleaf)`} />
          <path d={ART.leafShine} fill="#FECD73" />
        </g>
      </svg>
    </g>
  );
}
