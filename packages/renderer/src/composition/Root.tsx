import type { RenderPlan } from "@framebop/core";
import { Composition } from "remotion";
import { Episode } from "./Episode";

export const COMPOSITION_ID = "FramebopEpisode";

/** Placeholder until the render worker passes a real plan as input props. */
const EMPTY_PLAN: RenderPlan = {
  version: 2,
  width: 1920,
  height: 1080,
  fps: 30,
  durationInFrames: 1,
  scenes: [
    {
      sceneId: "empty",
      index: 0,
      from: 0,
      durationInFrames: 1,
      fadeInFrames: 0,
      shots: [],
      overlay: null,
    },
  ],
  audio: [],
  captions: [],
  captionsApproximate: false,
};

export function Root() {
  return (
    <Composition
      id={COMPOSITION_ID}
      component={Episode}
      defaultProps={{ plan: EMPTY_PLAN }}
      // Size, frame rate and length all come from the plan.
      calculateMetadata={({ props }) => ({
        durationInFrames: props.plan.durationInFrames,
        fps: props.plan.fps,
        width: props.plan.width,
        height: props.plan.height,
      })}
      durationInFrames={1}
      fps={30}
      width={1920}
      height={1080}
    />
  );
}
