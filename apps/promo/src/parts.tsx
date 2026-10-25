/**
 * Building blocks of the promo: the warm night background, the app stage (a
 * macOS-style window that stays on screen while recordings play inside it
 * and the camera moves), step chips, captions and the closing pills.
 * Colours are the site's (site/styles.css).
 */
import type { ReactNode } from "react";
import {
  AbsoluteFill,
  Easing,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { type Cue, type Cut, type Shot, cutFrames } from "./timeline";

export const FONT = "'Nunito Variable', 'Nunito', ui-rounded, sans-serif";
export const C = {
  night: "#141211",
  ink: "#FBF3E4",
  ink2: "#DDD3C3",
  ink3: "#B3A898",
  amber: "#FEBB3C",
  gradient: "linear-gradient(135deg, #FEBB3C 0%, #FD9A1E 48%, #FD7704 100%)",
};

export const ease = Easing.bezier(0.45, 0, 0.2, 1);

/** A tall (9:16) frame, for Reels and TikTok. */
export function useTall() {
  const { width, height } = useVideoConfig();
  return height > width;
}

/** 0 → 1 over `frames`, starting at `from`, eased. */
export function useIn(from = 0, frames = 18) {
  const frame = useCurrentFrame();
  return interpolate(frame, [from, from + frames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
}

export function Background() {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 90) * 4;
  return (
    <AbsoluteFill
      style={{
        background: `
          radial-gradient(60% 70% at ${82 + drift}% ${-5 - drift}%, rgba(253,140,30,0.32), transparent 70%),
          radial-gradient(50% 60% at ${2 - drift}% ${105 + drift}%, rgba(226,24,7,0.22), transparent 70%),
          ${C.night}`,
      }}
    />
  );
}

const WIN_W = 1440;
const WIN_H = 900;
const BAR = 38;
/** Frames over which one recording dissolves into the next. */
const DISSOLVE = 8;

function useCamera(shots: Shot[]) {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const tall = useTall();
  const at = (key: "scale" | "x" | "y") =>
    interpolate(
      frame,
      shots.map((s) => s.at),
      shots.map((s) => s[key]),
      { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease },
    );
  const scale = at("scale");
  const w = WIN_W * scale;
  let x = width / 2 - at("x") * w;
  // A narrow frame has no room to spare beside the window: keep its edges
  // out of view when it is wider than the frame, centre it when it is not.
  if (tall)
    x = w > width ? Math.min(0, Math.max(width - w, x)) : (width - w) / 2;
  return {
    scale,
    x,
    y: height / 2 - (BAR + at("y") * WIN_H) * scale,
  };
}

/**
 * The app in one window for the whole stage: cuts play one after another
 * (dissolving where `fadeIn` is set), the camera follows `shots`, and the
 * window rises in at the start.
 */
export function Stage({ cuts, shots }: { cuts: Cut[]; shots: Shot[] }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cam = useCamera(shots);
  const enter = spring({
    frame,
    fps,
    config: { damping: 200 },
    durationInFrames: 24,
  });

  let start = 0;
  const parts = cuts.map((cut, i) => {
    const frames = cutFrames(cut);
    const next = cuts[i + 1];
    // Keep playing under the next cut while it dissolves in.
    const tail = next?.fadeIn ? DISSOLVE : 0;
    const node = (
      <Sequence
        key={i}
        from={start}
        durationInFrames={frames + tail}
        layout="none"
      >
        <CutVideo cut={cut} />
      </Sequence>
    );
    start += frames;
    return node;
  });

  return (
    <AbsoluteFill
      style={{
        opacity: enter,
        transform: `translateY(${(1 - enter) * 140}px)`,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: WIN_W,
          height: WIN_H + BAR,
          transformOrigin: "0 0",
          transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.scale})`,
          borderRadius: 16,
          overflow: "hidden",
          background: "#0b0e13",
          boxShadow:
            "0 40px 120px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.09)",
        }}
      >
        <TitleBar />
        <div style={{ position: "relative", width: WIN_W, height: WIN_H }}>
          {parts}
        </div>
      </div>
    </AbsoluteFill>
  );
}

function CutVideo({ cut }: { cut: Cut }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = cut.fadeIn
    ? interpolate(frame, [0, DISSOLVE], [0, 1], { extrapolateRight: "clamp" })
    : 1;
  return (
    <OffthreadVideo
      src={staticFile(cut.src)}
      startFrom={Math.round(cut.from * fps)}
      playbackRate={cut.rate ?? 1}
      muted
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        opacity,
      }}
    />
  );
}

function TitleBar() {
  return (
    <div
      style={{
        height: BAR,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "0 16px",
        background: "#1c1a19",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
        <span
          key={c}
          style={{ width: 12, height: 12, borderRadius: 6, background: c }}
        />
      ))}
      <span
        style={{
          flex: 1,
          textAlign: "center",
          marginRight: 52,
          fontFamily: FONT,
          fontSize: 14,
          fontWeight: 700,
          color: C.ink3,
        }}
      >
        Framebop Studio
      </span>
    </div>
  );
}

/**
 * Step chips and captions for the stage. Each cue shows from its frame until
 * the next one; the outgoing one fades as the next fades in.
 */
export function Cues({ cues, end }: { cues: Cue[]; end: number }) {
  return (
    <>
      {cues.map((cue, i) => {
        const until = cues[i + 1]?.at ?? end;
        return (
          <Sequence
            key={i}
            from={cue.at}
            durationInFrames={until - cue.at + (i + 1 < cues.length ? 6 : 0)}
            layout="none"
          >
            <CueView
              cue={cue}
              frames={until - cue.at}
              last={i + 1 === cues.length}
            />
          </Sequence>
        );
      })}
    </>
  );
}

function CueView({
  cue,
  frames,
  last,
}: {
  cue: Cue;
  frames: number;
  last: boolean;
}) {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [0, 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
  // The last caption leaves before the player fills the frame.
  const out = last
    ? interpolate(frame, [frames - 34, frames - 22], [1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : interpolate(frame, [frames, frames + 6], [1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
  return (
    <AbsoluteFill style={{ opacity: Math.min(t, out) }}>
      <Chip n={cue.n} label={cue.label} rise={1 - t} />
      <Caption rise={1 - t}>{cue.caption}</Caption>
    </AbsoluteFill>
  );
}

/** "1 · Script" in the top-left corner, or top centre in a tall frame. */
export function Chip({
  n,
  label,
  rise = 0,
}: {
  n?: number;
  label: string;
  rise?: number;
}) {
  const tall = useTall();
  return (
    <div
      style={{
        position: "absolute",
        // Clear of the Reels and TikTok buttons at the top.
        left: tall ? "50%" : 64,
        top: tall ? 250 : 56,
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "10px 22px 10px 10px",
        borderRadius: 999,
        background: "rgba(28,26,25,0.78)",
        backdropFilter: "blur(16px)",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12)",
        fontFamily: FONT,
        fontSize: 30,
        fontWeight: 800,
        color: C.ink,
        whiteSpace: "nowrap",
        transform: `translate(${tall ? "-50%" : "0"}, ${rise * -14}px)`,
      }}
    >
      <span
        style={{
          display: "grid",
          placeItems: "center",
          width: 44,
          height: 44,
          borderRadius: 22,
          background: C.gradient,
          color: "#212021",
          fontSize: 24,
        }}
      >
        {n ?? "✦"}
      </span>
      {label}
    </div>
  );
}

/** A caption in a glass pill at the bottom. */
export function Caption({
  children,
  rise = 0,
}: {
  children: ReactNode;
  rise?: number;
}) {
  const tall = useTall();
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        // Above the account name and description Reels and TikTok lay over the bottom.
        bottom: tall ? 430 : 64,
        display: "flex",
        justifyContent: "center",
        transform: `translateY(${rise * 16}px)`,
      }}
    >
      <div
        style={{
          maxWidth: tall ? 860 : 1400,
          padding: "18px 34px",
          borderRadius: 26,
          background: "rgba(20,18,17,0.8)",
          backdropFilter: "blur(18px)",
          boxShadow:
            "inset 0 0 0 1px rgba(255,255,255,0.12), 0 20px 50px rgba(0,0,0,0.35)",
          fontFamily: FONT,
          fontSize: 46,
          fontWeight: 750,
          letterSpacing: -0.5,
          color: C.ink,
          textAlign: "center",
          textWrap: "balance",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** Words that rise in one after another. */
export function Words({
  text,
  size,
  from = 0,
  stagger = 3,
  color = C.ink,
  weight = 850,
}: {
  text: string;
  size: number;
  from?: number;
  stagger?: number;
  color?: string;
  weight?: number;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <span
      style={{
        fontFamily: FONT,
        fontSize: size,
        fontWeight: weight,
        letterSpacing: -size * 0.03,
        color,
      }}
    >
      {text.split(" ").map((word, i) => {
        const s = spring({
          frame: frame - from - i * stagger,
          fps,
          config: { damping: 200 },
        });
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              marginRight: size * 0.26,
              opacity: s,
              transform: `translateY(${(1 - s) * size * 0.45}px)`,
            }}
          >
            {word}
          </span>
        );
      })}
    </span>
  );
}

export function Pill({
  children,
  delay,
}: {
  children: ReactNode;
  delay: number;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({
    frame: frame - delay,
    fps,
    config: { damping: 14, stiffness: 140 },
  });
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "20px 34px 20px 22px",
        borderRadius: 999,
        background: "rgba(38,34,31,0.85)",
        boxShadow: "inset 0 0 0 1.5px rgba(255,255,255,0.12)",
        fontFamily: FONT,
        fontSize: 52,
        fontWeight: 800,
        color: C.ink,
        opacity: Math.min(1, s * 1.4),
        transform: `scale(${0.6 + 0.4 * s})`,
      }}
    >
      <span
        style={{
          display: "grid",
          placeItems: "center",
          width: 46,
          height: 46,
          borderRadius: 23,
          background: C.gradient,
          color: "#212021",
          fontSize: 30,
        }}
      >
        ✓
      </span>
      {children}
    </div>
  );
}
