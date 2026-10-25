/**
 * The promo: logo, the promise, the three steps in the real app on one
 * stage, the finished video (the app's player grows into it), what it does
 * not need, and where to find it. Parts crossfade into each other; the
 * voice-over runs over the whole timeline (see timeline.ts).
 */
import type { ReactNode } from "react";
import {
  AbsoluteFill,
  Audio,
  OffthreadVideo,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import "@fontsource-variable/nunito";
import { Logo } from "./Logo";
import {
  Background,
  C,
  Chip,
  Cues,
  FONT,
  Pill,
  Stage,
  Words,
  ease,
  useIn,
  useTall,
} from "./parts";
import {
  OVERLAP,
  PARTS,
  PART_STARTS,
  STAGE_CUES,
  STAGE_CUTS,
  STAGE_FRAMES,
  STAGE_SHOTS,
  STAGE_SHOTS_TALL,
  VOICE,
  type Part,
} from "./timeline";

export type PromoProps = { music: boolean };

function Intro() {
  const t = useIn(0, 20);
  const w = useIn(14, 18);
  return (
    <AbsoluteFill
      style={{ alignItems: "center", justifyContent: "center", gap: 40 }}
    >
      <div
        style={{
          transform: `scale(${0.7 + 0.3 * t})`,
          opacity: t,
          filter: "drop-shadow(0 30px 60px rgba(160,50,0,0.45))",
        }}
      >
        <Logo size={300} blinkAt={[34]} />
      </div>
      <div
        style={{
          opacity: w,
          transform: `translateY(${(1 - w) * 20}px)`,
          fontFamily: FONT,
          fontWeight: 850,
          fontSize: 96,
          letterSpacing: -2,
          color: C.ink,
        }}
      >
        Frame
        <span
          style={{
            background: C.gradient,
            WebkitBackgroundClip: "text",
            color: "transparent",
          }}
        >
          bop
        </span>
        <span
          style={{
            marginLeft: 24,
            fontSize: 40,
            fontWeight: 700,
            letterSpacing: 10,
            color: C.ink3,
          }}
        >
          STUDIO
        </span>
      </div>
    </AbsoluteFill>
  );
}

function Pledge() {
  const tall = useTall();
  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        padding: tall ? "0 90px" : "0 160px",
        textAlign: "center",
      }}
    >
      <div style={{ lineHeight: 1.08 }}>
        <Words text="Make animated videos with AI" size={104} from={4} />
        <br />
        <Words
          text="that runs on your own computer."
          size={104}
          from={20}
          color={C.amber}
        />
      </div>
    </AbsoluteFill>
  );
}

/** Starts full-frame, where the app's player left off, then settles into a card. */
function Finished({ src, frames }: { src: string; frames: number }) {
  const frame = useCurrentFrame();
  const settle = interpolate(frame, [10, 34], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
  const chip = useIn(26, 12);
  const { width: frameWidth } = useVideoConfig();
  const width = frameWidth - (useTall() ? 120 : 320) * settle;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          width,
          height: (width * 9) / 16,
          borderRadius: 24 * settle,
          overflow: "hidden",
          boxShadow: `0 40px 120px rgba(0,0,0,${0.6 * settle}), 0 0 0 1px rgba(255,255,255,${0.1 * settle})`,
        }}
      >
        <OffthreadVideo
          src={staticFile(src)}
          volume={(f) =>
            // Let the sentence finish, then fade before the next one starts.
            interpolate(f, [frames - 8, frames - 2], [0.95, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            })
          }
          style={{ width: "100%", height: "100%" }}
        />
      </div>
      <div style={{ opacity: chip }}>
        <Chip label="Made with Framebop" rise={1 - chip} />
      </div>
    </AbsoluteFill>
  );
}

function NoNeeds() {
  const tall = useTall();
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          display: "flex",
          flexDirection: tall ? "column" : "row",
          alignItems: "center",
          gap: 28,
        }}
      >
        <Pill delay={8}>No account</Pill>
        <Pill delay={24}>No subscription</Pill>
        <Pill delay={40}>No cloud</Pill>
      </div>
    </AbsoluteFill>
  );
}

function Outro() {
  const tall = useTall();
  const t = useIn(0, 18);
  const u = useIn(14, 18);
  return (
    <AbsoluteFill
      style={{ alignItems: "center", justifyContent: "center", gap: 34 }}
    >
      <div
        style={{
          opacity: t,
          transform: `scale(${0.85 + 0.15 * t})`,
          filter: "drop-shadow(0 30px 60px rgba(160,50,0,0.45))",
        }}
      >
        <Logo size={190} blinkAt={[60]} />
      </div>
      <div
        style={{
          opacity: t,
          fontFamily: FONT,
          fontWeight: 900,
          fontSize: 120,
          letterSpacing: -3,
          color: C.ink,
        }}
      >
        framebop.com
      </div>
      <div
        style={{
          opacity: u,
          display: "grid",
          justifyItems: "center",
          gap: 14,
          fontFamily: FONT,
          color: C.ink2,
        }}
      >
        {tall ? (
          <span
            style={{
              display: "grid",
              justifyItems: "center",
              gap: 6,
              fontSize: 40,
              fontWeight: 750,
            }}
          >
            <span>Free and open source</span>
            <span>github.com/eaabak/framebop-studio</span>
          </span>
        ) : (
          <span style={{ fontSize: 40, fontWeight: 750 }}>
            Free and open source · github.com/eaabak/framebop-studio
          </span>
        )}
        <span style={{ fontSize: 30, fontWeight: 650, color: C.ink3 }}>
          Alpha · macOS on Apple silicon
        </span>
      </div>
    </AbsoluteFill>
  );
}

function PartView({ part }: { part: Part }) {
  const tall = useTall();
  switch (part.kind) {
    case "intro":
      return <Intro />;
    case "promise":
      return <Pledge />;
    case "stage":
      return (
        <>
          <Stage
            cuts={STAGE_CUTS}
            shots={tall ? STAGE_SHOTS_TALL : STAGE_SHOTS}
          />
          <Cues cues={STAGE_CUES} end={STAGE_FRAMES} />
        </>
      );
    case "finished":
      return <Finished src={part.src} frames={part.frames} />;
    case "noNeeds":
      return <NoNeeds />;
    case "outro":
      return <Outro />;
  }
}

/** Crossfades a part with its neighbours over OVERLAP frames. */
function Crossfade({
  frames,
  first,
  last,
  children,
}: {
  frames: number;
  first: boolean;
  last: boolean;
  children: ReactNode;
}) {
  const frame = useCurrentFrame();
  const fadeIn = first
    ? 1
    : interpolate(frame, [0, OVERLAP], [0, 1], { extrapolateRight: "clamp" });
  const fadeOut = last
    ? 1
    : interpolate(frame, [frames - OVERLAP, frames], [1, 0], {
        extrapolateLeft: "clamp",
      });
  return (
    <AbsoluteFill style={{ opacity: Math.min(fadeIn, fadeOut) }}>
      {children}
    </AbsoluteFill>
  );
}

export function Promo({ music }: PromoProps) {
  const { durationInFrames } = useVideoConfig();
  const tall = useTall();
  return (
    <AbsoluteFill style={{ backgroundColor: C.night }}>
      <Background />
      {PARTS.map((part, i) => (
        <Sequence key={i} from={PART_STARTS[i]!} durationInFrames={part.frames}>
          {/* The stage hands over to the finished video without fading out,
              except in a tall frame, where the app shows above and below the player. */}
          <Crossfade
            frames={part.frames}
            first={i === 0}
            last={i === PARTS.length - 1 || (part.kind === "stage" && !tall)}
          >
            <PartView part={part} />
          </Crossfade>
        </Sequence>
      ))}
      {VOICE.map((line) => (
        <Sequence key={line.src} from={line.at} layout="none">
          <Audio src={staticFile(line.src)} />
        </Sequence>
      ))}
      {music ? (
        <Audio
          src={staticFile("music/pad.wav")}
          volume={(f) =>
            interpolate(
              f,
              [0, 30, durationInFrames - 60, durationInFrames],
              [0, 0.55, 0.55, 0],
              {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              },
            )
          }
        />
      ) : null}
    </AbsoluteFill>
  );
}
