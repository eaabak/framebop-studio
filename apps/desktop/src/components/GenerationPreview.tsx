import { useId } from "react";
import { t } from "../i18n";
import { cx } from "./ui";

/** Framebop's ember mist, shown only while a clip is being produced. */
export function GenerationPreview({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  const filterId = `mist-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <div
      className={cx(
        "generation-preview",
        compact && "generation-preview-compact",
        className,
      )}
      aria-label={t("jobs:labelGenerateClip", { engine: "Framebop" })}
      aria-busy="true"
    >
      <svg
        className="generation-mist"
        viewBox="0 0 600 400"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <defs>
          <filter
            id={filterId}
            x="-50%"
            y="-50%"
            width="200%"
            height="200%"
            colorInterpolationFilters="sRGB"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.009 0.015"
              numOctaves="3"
              seed="12"
              result="noise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale="85"
              xChannelSelector="R"
              yChannelSelector="G"
            />
            <feGaussianBlur stdDeviation="18" />
          </filter>
        </defs>
        <g filter={`url(#${filterId})`}>
          <ellipse
            className="generation-wisp generation-wisp-a"
            cx="170"
            cy="265"
            rx="180"
            ry="78"
            fill="#ff7a1f"
          />
          <ellipse
            className="generation-wisp generation-wisp-b"
            cx="430"
            cy="160"
            rx="160"
            ry="90"
            fill="#b9bec8"
          />
          <ellipse
            className="generation-wisp generation-wisp-c"
            cx="300"
            cy="300"
            rx="145"
            ry="60"
            fill="#ffcf99"
          />
        </g>
      </svg>
    </div>
  );
}
