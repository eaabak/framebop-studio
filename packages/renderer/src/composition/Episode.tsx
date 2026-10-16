/**
 * Draws a render plan, frame by frame. Every position, length and fade comes
 * from the plan; nothing is decided here, so the plan alone defines the
 * video.
 */
import type {
  ImageMotion,
  PlanAudio,
  PlanCaption,
  PlanScene,
  PlanShot,
  RenderPlan,
} from "@framebop/core";
import { type CSSProperties, useMemo } from "react";
import {
  AbsoluteFill,
  Audio,
  Freeze,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  cancelRender,
  continueRender,
  delayRender,
} from "remotion";
import { type Hold, AnimatedScene } from "../animation/AnimatedScene";

const FONT =
  "Inter, 'Helvetica Neue', 'Segoe UI', Roboto, Arial, 'Noto Sans', sans-serif";

const CLAMP = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

/** How far a still moves over its scene. Kept gentle on purpose. */
const ZOOM = 0.12;
const SHIFT = 0.05;

function motionTransform(motion: ImageMotion, progress: number, frame: number) {
  const p = progress;
  switch (motion) {
    case "static":
      return "none";
    case "push_in":
      return `scale(${1 + ZOOM * p})`;
    case "pull_out":
      return `scale(${1 + ZOOM * (1 - p)})`;
    // A pan needs room to move, so the image is enlarged slightly first.
    case "pan_left":
      return `scale(${1 + ZOOM}) translateX(${(SHIFT - 2 * SHIFT * p) * 100}%)`;
    case "pan_right":
      return `scale(${1 + ZOOM}) translateX(${(-SHIFT + 2 * SHIFT * p) * 100}%)`;
    case "tilt_up":
      return `scale(${1 + ZOOM}) translateY(${(-SHIFT + 2 * SHIFT * p) * 100}%)`;
    case "tilt_down":
      return `scale(${1 + ZOOM}) translateY(${(SHIFT - 2 * SHIFT * p) * 100}%)`;
    case "handheld": {
      // A slow, deterministic drift: the same frame always looks the same.
      const x = Math.sin(frame / 23) * 0.6 + Math.sin(frame / 11) * 0.25;
      const y = Math.cos(frame / 29) * 0.5 + Math.sin(frame / 13) * 0.2;
      return `scale(1.06) translate(${x}%, ${y}%)`;
    }
  }
}

const cover: CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
};

/** Keeps Remotion from taking a frame until the animation's pictures load. */
function hold(): Hold {
  const handle = delayRender("Loading the animation's pictures");
  return {
    release: () => continueRender(handle),
    fail: (error) => cancelRender(error),
  };
}

/** A scene's shots, back to back from its first frame. */
function Visual({ scene }: { scene: PlanScene }) {
  return (
    <>
      {scene.shots.map((shot) => (
        <Sequence
          key={shot.from}
          from={shot.from}
          durationInFrames={shot.durationInFrames}
          layout="none"
        >
          <ShotVisual shot={shot} />
        </Sequence>
      ))}
    </>
  );
}

function ShotVisual({ shot }: { shot: PlanShot }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const { visual, durationInFrames } = shot;
  const urls = useMemo(
    () =>
      visual.kind === "animation"
        ? Object.fromEntries(
            Object.entries(visual.images).map(([key, file]) => [key, file.src]),
          )
        : {},
    [visual],
  );
  const size = useMemo(() => ({ width, height }), [width, height]);

  if (visual.kind === "animation") {
    return (
      <AbsoluteFill style={{ overflow: "hidden" }}>
        <AnimatedScene
          spec={visual.spec}
          mouth={visual.mouth}
          frame={frame}
          fps={fps}
          urls={urls}
          size={size}
          hold={hold}
        />
      </AbsoluteFill>
    );
  }

  if (visual.kind === "image") {
    const progress = durationInFrames > 1 ? frame / (durationInFrames - 1) : 0;
    return (
      <AbsoluteFill style={{ overflow: "hidden" }}>
        <Img
          src={visual.src}
          style={{
            ...cover,
            transform: motionTransform(visual.motion, progress, frame),
          }}
        />
      </AbsoluteFill>
    );
  }

  if (visual.kind === "video") {
    const held = durationInFrames - visual.playFrames;
    const clip = (
      <OffthreadVideo
        src={visual.src}
        startFrom={visual.startFrame}
        muted
        style={cover}
      />
    );
    return (
      <AbsoluteFill>
        <Sequence durationInFrames={visual.playFrames} layout="none">
          {clip}
        </Sequence>
        {held > 0 && (
          // Only for a hold the user chose: the clip's last frame stays.
          <Sequence from={visual.playFrames} layout="none">
            <Freeze frame={visual.playFrames - 1}>{clip}</Freeze>
          </Sequence>
        )}
      </AbsoluteFill>
    );
  }

  return null;
}

function Overlay({ scene }: { scene: PlanScene }) {
  const { height } = useVideoConfig();
  if (!scene.overlay) return null;
  const placement: Record<string, CSSProperties> = {
    top: { justifyContent: "flex-start", paddingTop: height * 0.08 },
    center: { justifyContent: "center" },
    // Above where captions sit, so the two never cover each other.
    bottom: { justifyContent: "flex-end", paddingBottom: height * 0.2 },
  };
  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        padding: `0 ${height * 0.1}px`,
        ...placement[scene.overlay.position],
      }}
    >
      <div
        style={{
          fontFamily: FONT,
          fontSize: height * 0.05,
          fontWeight: 700,
          lineHeight: 1.2,
          color: "white",
          textAlign: "center",
          maxWidth: "85%",
          textShadow: `0 ${height * 0.003}px ${height * 0.02}px rgba(0,0,0,0.85)`,
          whiteSpace: "pre-wrap",
        }}
      >
        {scene.overlay.text}
      </div>
    </AbsoluteFill>
  );
}

function SceneView({ scene }: { scene: PlanScene }) {
  const frame = useCurrentFrame();
  const opacity =
    scene.fadeInFrames > 0
      ? interpolate(frame, [0, scene.fadeInFrames], [0, 1], CLAMP)
      : 1;
  return (
    <AbsoluteFill style={{ opacity, backgroundColor: "black" }}>
      <Visual scene={scene} />
      <Overlay scene={scene} />
    </AbsoluteFill>
  );
}

function Sound({ clip }: { clip: PlanAudio }) {
  const { durationInFrames, fadeInFrames, fadeOutFrames, volume } = clip;
  return (
    <Audio
      src={clip.src}
      loop={clip.loop}
      volume={(f) => {
        let level = volume;
        if (fadeInFrames > 0) {
          level *= interpolate(f, [0, fadeInFrames], [0, 1], CLAMP);
        }
        if (fadeOutFrames > 0) {
          level *= interpolate(
            f,
            [durationInFrames - fadeOutFrames, durationInFrames],
            [1, 0],
            CLAMP,
          );
        }
        return level;
      }}
    />
  );
}

function Caption({ caption }: { caption: PlanCaption }) {
  const { height } = useVideoConfig();
  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: height * 0.06,
      }}
    >
      <div
        style={{
          fontFamily: FONT,
          fontSize: height * 0.036,
          lineHeight: 1.3,
          color: "white",
          backgroundColor: "rgba(0,0,0,0.6)",
          padding: `${height * 0.008}px ${height * 0.018}px`,
          borderRadius: height * 0.006,
          maxWidth: "70%",
          textAlign: "center",
        }}
      >
        {caption.text}
      </div>
    </AbsoluteFill>
  );
}

export function Episode({ plan }: { plan: RenderPlan }) {
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {plan.scenes.map((scene) => (
        <Sequence
          key={scene.sceneId}
          from={scene.from}
          durationInFrames={scene.durationInFrames}
        >
          <SceneView scene={scene} />
        </Sequence>
      ))}
      {plan.captions.map((caption, index) => (
        <Sequence
          key={`caption-${index}`}
          from={caption.from}
          durationInFrames={caption.durationInFrames}
        >
          <Caption caption={caption} />
        </Sequence>
      ))}
      {plan.audio.map((clip, index) => (
        <Sequence
          key={`audio-${index}`}
          from={clip.from}
          durationInFrames={clip.durationInFrames}
          layout="none"
        >
          <Sound clip={clip} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
