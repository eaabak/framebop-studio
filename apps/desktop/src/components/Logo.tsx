/**
 * The Framebop icon: an orange tile with a TV-headed character and a sprout.
 * `animated` brings it to life for loading: the eyes look around and blink
 * and the side leaf sways. Reduced motion stops it (see styles.css).
 * `tile={false}` draws the character alone, without the orange tile.
 */
import { useId } from "react";
import { ART } from "./logoArt";
import { cx } from "./ui";

const CREAM = "#FBF3E4";

export function LogoMark({
  className,
  animated = false,
  tile = true,
}: {
  className?: string;
  animated?: boolean;
  tile?: boolean;
}) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const url = (name: string) => `url(#${id}${name})`;
  return (
    <svg
      viewBox={tile ? "57 67 908 889" : "167 176 725 695"}
      className={cx(className, animated && "logo-animated")}
      aria-hidden
    >
      <defs>
        <linearGradient
          id={`${id}bg`}
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
          id={`${id}glow`}
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
        <radialGradient
          id={`${id}shade`}
          gradientUnits="userSpaceOnUse"
          cx="800"
          cy="350"
          r="165"
          gradientTransform="translate(800 350) scale(1 0.75) translate(-800 -350)"
        >
          <stop offset="0" stopColor="#A81E06" stopOpacity="0.38" />
          <stop offset="1" stopColor="#A81E06" stopOpacity="0" />
        </radialGradient>
        <linearGradient
          id={`${id}body`}
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
          id={`${id}sheen`}
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
          id={`${id}rim`}
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
          id={`${id}tip`}
          gradientUnits="userSpaceOnUse"
          x1="729"
          y1="264"
          x2="745"
          y2="199"
        >
          <stop offset="0" stopColor="#FEAB2A" stopOpacity="0" />
          <stop offset="0.55" stopColor="#FEC255" stopOpacity="0.8" />
          <stop offset="1" stopColor="#FECD6D" />
        </linearGradient>
        <linearGradient
          id={`${id}leaf`}
          gradientUnits="userSpaceOnUse"
          x1="788"
          y1="379"
          x2="825"
          y2="269"
        >
          <stop offset="0" stopColor="#FD7704" />
          <stop offset="1" stopColor="#FEBB3C" />
        </linearGradient>
        <clipPath id={`${id}screen`}>
          <path d={ART.screen} />
        </clipPath>
      </defs>
      {tile && (
        <>
          <path d={ART.tile} fill={url("bg")} />
          <path d={ART.tile} fill={url("glow")} />
          <path d={ART.tile} fill={url("shade")} />
        </>
      )}
      <path d={ART.body} fill={url("body")} />
      <path d={ART.body} fill={url("sheen")} />
      <path d={ART.rim} fill={url("rim")} />
      <path d={ART.tip} fill={url("tip")} />
      <path d={ART.frame} fill={CREAM} />
      <path d={ART.screen} fill="#212021" />
      <g clipPath={url("screen")}>
        <g className="logo-eyes">
          <path className="logo-eye" d={ART.eyeLeft} fill={CREAM} />
          <path className="logo-eye" d={ART.eyeRight} fill={CREAM} />
        </g>
      </g>
      <g className="logo-sprout">
        <path d={ART.leaf} fill={url("leaf")} />
        <path d={ART.leafShine} fill="#FECD73" />
      </g>
    </svg>
  );
}

/** The mark with the "Framebop Studio" wordmark, for the toolbar. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        "flex items-baseline font-[ui-rounded,'SF_Pro_Rounded',var(--font-sans)] font-extrabold tracking-tight",
        className,
      )}
    >
      <span className="text-fg">Frame</span>
      <span className="text-accent">bop</span>
      <span className="ml-1.5 text-[0.62em] font-semibold tracking-[0.22em] text-fg-dim uppercase">
        Studio
      </span>
    </span>
  );
}
