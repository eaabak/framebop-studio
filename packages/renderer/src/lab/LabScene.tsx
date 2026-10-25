/**
 * Draws a Framebop Lab experiment at one frame. Each kind of experiment has
 * its own scene; they share the cinema kit in ../cinema.
 */
import type { AnimationSpec } from "@framebop/core";
import type { Hold } from "../animation/PixiScene";
import { BrachistochroneScene } from "./Brachistochrone";
import { MullerLyerScene } from "./MullerLyer";
import { SceneView } from "../scene/SceneView";

export function LabScene({
  spec,
  frame,
  fps,
  size,
  hold,
}: {
  spec: AnimationSpec;
  /** The output frame. */
  frame: number;
  /** The output frame rate. */
  fps: number;
  /** Pixels of the drawing surface; half the spec's size if unset. */
  size?: { width: number; height: number };
  hold?: () => Hold;
}) {
  const lab = spec.lab;
  if (!lab) return null;
  // The timeline is written in the spec's frames; any output rate works.
  const time = (frame * spec.fps) / fps;
  switch (lab.kind) {
    case "brachistochrone":
      return (
        <BrachistochroneScene
          lab={lab}
          frame={time}
          fps={spec.fps}
          width={spec.width}
          height={spec.height}
          duration={spec.durationFrames}
          pixels={size ?? { width: spec.width / 2, height: spec.height / 2 }}
          hold={hold}
        />
      );
    case "scene":
      return <SceneView lab={lab} frame={time} hold={hold} />;
    case "muller-lyer":
      return (
        <MullerLyerScene
          lab={lab}
          frame={time}
          width={spec.width}
          height={spec.height}
          duration={spec.durationFrames}
          hold={hold}
        />
      );
  }
}
