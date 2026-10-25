import { describe, expect, it } from "vitest";
import { whichPathWins } from "./experiments";
import {
  cycloidPath,
  exactArrivals,
  simulateSlide,
  stateAt,
  straightPath,
} from "./physics";

const G = 9.81;

describe("frictionless slide", () => {
  it.each([
    [2, 1.1],
    [1.8, 1],
    [1, 2],
    [3, 1],
  ])("matches the closed forms for a %s × %s m drop", (span, drop) => {
    const exact = exactArrivals(span, drop, G);
    const straight = simulateSlide(straightPath(span, drop), G);
    const curve = simulateSlide(cycloidPath(span, drop), G);
    expect(straight.arrival).toBeCloseTo(exact.straight, 9);
    expect(Math.abs(curve.arrival / exact.cycloid - 1)).toBeLessThan(1e-5);
    // The cycloid is the fastest path, so it always wins.
    expect(curve.arrival).toBeLessThan(straight.arrival);
    // Both end exactly at the finish.
    for (const path of [straight, curve]) {
      const end = path.points[path.points.length - 1]!;
      expect(end.x).toBeCloseTo(span, 9);
      expect(end.y).toBeCloseTo(drop, 9);
    }
  });

  it("conserves energy at every moment", () => {
    const curve = simulateSlide(cycloidPath(2, 1.1), G);
    for (let time = 0; time < curve.arrival; time += 0.01) {
      const state = stateAt(curve, time);
      expect(state.speed).toBeCloseTo(Math.sqrt(2 * G * state.y), 2);
    }
  });

  it("moves forward only, and answers each moment on its own", () => {
    const curve = simulateSlide(cycloidPath(2, 1.1), G);
    let before = -1;
    for (let time = 0; time <= curve.arrival + 0.1; time += 0.005) {
      const state = stateAt(curve, time);
      expect(state.s).toBeGreaterThanOrEqual(before);
      before = state.s;
    }
    expect(stateAt(curve, 0.4)).toEqual(stateAt(curve, 0.4));
    expect(stateAt(curve, curve.arrival + 1).arrived).toBe(true);
  });

  it("follows constant acceleration exactly on the straight track", () => {
    const line = simulateSlide(straightPath(2, 1.1), G);
    const accel = (G * 1.1) / line.length;
    for (const time of [0.1, 0.37, 0.8]) {
      expect(stateAt(line, time).s).toBeCloseTo(0.5 * accel * time * time, 9);
    }
  });
});

describe("Which Path Wins?", () => {
  it("is decided by the simulation, inside its timeline", () => {
    const spec = whichPathWins();
    const lab = spec.lab!;
    if (lab.kind !== "brachistochrone") throw new Error("Not the race.");
    expect(spec.width / spec.height).toBeCloseTo(9 / 16);
    expect(spec.durationFrames).toBe(18 * spec.fps);
    const exact = exactArrivals(lab.span, lab.drop, lab.gravity);
    const toFrame = (seconds: number) =>
      lab.releaseFrame + seconds * lab.slowMotion * spec.fps;
    // The finish is lower than the start, and both arrive before the reveal.
    expect(lab.drop).toBeGreaterThan(0);
    expect(toFrame(exact.cycloid)).toBeGreaterThan(lab.beats.experiment);
    expect(toFrame(exact.straight)).toBeLessThan(lab.beats.reveal);
    expect(exact.cycloid).toBeLessThan(exact.straight);
  });
});
