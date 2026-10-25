/**
 * The Framebop icon, drawn from the desktop app's artwork so it stays in
 * step with the brand. `blinkAt` lists frames where the eyes blink; the
 * eyes glance left and right on their own, and the sprout sways.
 */
import { interpolate, useCurrentFrame } from "remotion";
import { ART } from "../../desktop/src/components/logoArt";

const CREAM = "#FBF3E4";

export function Logo({
  size,
  blinkAt = [],
}: {
  size: number;
  blinkAt?: number[];
}) {
  const frame = useCurrentFrame();
  const blink = blinkAt.reduce((open, at) => {
    const d = frame - at;
    return d >= 0 && d < 8
      ? Math.min(open, interpolate(d, [0, 3, 8], [1, 0.1, 1]))
      : open;
  }, 1);
  const look = Math.sin(frame / 22) * 14;
  const sway = Math.sin(frame / 18) * 5;

  return (
    <svg width={size} height={size} viewBox="51 51 920 920">
      <defs>
        <linearGradient
          id="bg"
          gradientUnits="userSpaceOnUse"
          x1="772"
          y1="979"
          x2="341"
          y2="208"
        >
          <stop offset="0" stopColor="#E21807" />
          <stop offset="1" stopColor="#FE7916" />
        </linearGradient>
        <linearGradient
          id="glow"
          gradientUnits="userSpaceOnUse"
          x1="57"
          y1="67"
          x2="256"
          y2="437"
        >
          <stop offset="0" stopColor="#FEBF3C" />
          <stop offset="0.19" stopColor="#FEBF3C" />
          <stop offset="0.72" stopColor="#FB810F" stopOpacity="0.9" />
          <stop offset="1" stopColor="#FB7F0E" stopOpacity="0" />
        </linearGradient>
        <linearGradient
          id="body"
          gradientUnits="userSpaceOnUse"
          x1="657"
          y1="821"
          x2="389"
          y2="290"
        >
          <stop offset="0" stopColor="#FE590A" />
          <stop offset="1" stopColor="#FDA624" />
        </linearGradient>
        <radialGradient
          id="sheen"
          gradientUnits="userSpaceOnUse"
          cx="330"
          cy="290"
          r="300"
          gradientTransform="translate(330 290) scale(1 0.5) translate(-330 -290)"
        >
          <stop offset="0" stopColor="#FECD6B" stopOpacity="0.95" />
          <stop offset="0.5" stopColor="#FEC35A" stopOpacity="0.6" />
          <stop offset="1" stopColor="#FDAB29" stopOpacity="0" />
        </radialGradient>
        <linearGradient
          id="rim"
          gradientUnits="userSpaceOnUse"
          x1="316"
          y1="0"
          x2="590"
          y2="0"
        >
          <stop offset="0" stopColor="#FDF3D4" />
          <stop offset="0.6" stopColor="#FDEBC0" stopOpacity="0.85" />
          <stop offset="1" stopColor="#FDD48C" stopOpacity="0" />
        </linearGradient>
        <linearGradient
          id="leaf"
          gradientUnits="userSpaceOnUse"
          x1="788"
          y1="379"
          x2="825"
          y2="269"
        >
          <stop offset="0" stopColor="#FD7704" />
          <stop offset="1" stopColor="#FEBB3C" />
        </linearGradient>
        <clipPath id="screen">
          <path d={ART.screen} />
        </clipPath>
      </defs>
      <path d={ART.tile} fill="url(#bg)" />
      <path d={ART.tile} fill="url(#glow)" />
      <path d={ART.body} fill="url(#body)" />
      <path d={ART.body} fill="url(#sheen)" />
      <path d={ART.rim} fill="url(#rim)" />
      <path d={ART.frame} fill={CREAM} />
      <path d={ART.screen} fill="#212021" />
      <g clipPath="url(#screen)">
        <g transform={`translate(${look} 0)`}>
          <g transform={`translate(0 ${560 * (1 - blink)}) scale(1 ${blink})`}>
            <path d={ART.eyeLeft} fill={CREAM} />
            <path d={ART.eyeRight} fill={CREAM} />
          </g>
        </g>
      </g>
      <g transform={`rotate(${sway} 790 330)`}>
        <path d={ART.leaf} fill="url(#leaf)" />
        <path d={ART.leafShine} fill="#FECD73" />
      </g>
    </svg>
  );
}
