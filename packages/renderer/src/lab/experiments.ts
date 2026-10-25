/**
 * The Lab's ready-made experiments, and their simulations. A simulation is
 * solved once per configuration and kept, so a frame only looks it up.
 */
import {
  type AnimationSpec,
  AnimationSpecSchema,
  type BrachistochroneLab,
} from "@framebop/core";
import {
  type Trajectory,
  cycloidPath,
  simulateSlide,
  straightPath,
} from "./physics";

/** Which Path Wins? A straight ramp against the brachistochrone. */
export function whichPathWins(): AnimationSpec {
  return AnimationSpecSchema.parse({
    version: 1,
    width: 1080,
    height: 1920,
    renderer: "lab",
    fps: 30,
    durationFrames: 540,
    sky: { top: "#0B0D12", bottom: "#0B0D12" },
    camera: { x: 0, y: 0, zoom: 1 },
    assets: {},
    layers: [],
    characters: [],
    lab: {
      kind: "brachistochrone",
      span: 2,
      drop: 1.1,
      gravity: 9.81,
      slowMotion: 5,
      replaySlowMotion: 5,
      releaseFrame: 36,
      beats: {
        prediction: 4,
        experiment: 30,
        reveal: 186,
        explanation: 240,
        closing: 450,
      },
      text: {
        hook: "WHICH PATH WINS?",
        prediction: "STRAIGHT OR CURVED?",
        explanation: "STEEP DROP. EARLY SPEED.",
        closing: "LONGER CAN BE FASTER.",
        contenders: ["STRAIGHT", "CURVED"],
      },
    },
  });
}

export interface BrachistochroneRun {
  straight: Trajectory;
  curve: Trajectory;
}

const runs = new Map<string, BrachistochroneRun>();

export function brachistochroneRun(
  lab: Pick<BrachistochroneLab, "span" | "drop" | "gravity">,
): BrachistochroneRun {
  const key = `${lab.span}:${lab.drop}:${lab.gravity}`;
  let run = runs.get(key);
  if (!run) {
    run = {
      straight: simulateSlide(straightPath(lab.span, lab.drop), lab.gravity),
      curve: simulateSlide(cycloidPath(lab.span, lab.drop), lab.gravity),
    };
    runs.set(key, run);
  }
  return run;
}

/** Simulated seconds since the release, at a frame of the spec's timeline. */
export function simulatedTime(
  lab: BrachistochroneLab,
  frame: number,
  fps: number,
) {
  return Math.max(0, (frame - lab.releaseFrame) / fps / lab.slowMotion);
}

/** The frame (fractional) an object arrives, from its simulated time. */
export function arrivalFrame(
  lab: BrachistochroneLab,
  trajectory: Trajectory,
  fps: number,
) {
  return lab.releaseFrame + trajectory.arrival * lab.slowMotion * fps;
}
