/**
 * Camera choreography: keyed poses eased one into the next, an optional
 * pull towards a moving subject, and deterministic shakes. A pose depends
 * only on the frame (and the subject at that frame), so any frame can be
 * drawn on its own.
 */
import type { Ease } from "@framebop/core";
import { EASE, clamp, lerp } from "../animation/timing";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface CameraPose {
  target: Vec3;
  /** Turn around the target, radians; 0 looks straight along −z. */
  yaw: number;
  /** Height above the target's horizon, radians. */
  pitch: number;
  distance: number;
  /** Vertical field of view, degrees. */
  fov: number;
  /** Tilt of the picture, radians. */
  roll: number;
}

export interface CameraKey extends CameraPose {
  frame: number;
  /** How far the target leans towards the subject, 0..1. */
  follow?: number;
  /** The ease from the previous key to this one. */
  ease?: Ease;
}

export interface Shake {
  frame: number;
  /** World units. */
  amplitude: number;
  frames: number;
}

export const vec = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

export const mixVec = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
  z: lerp(a.z, b.z, t),
});

/** The pose at a frame; `subject` is what keys with `follow` lean towards. */
export function poseAt(
  keys: readonly CameraKey[],
  frame: number,
  subject?: Vec3,
): CameraPose {
  const resolve = (key: CameraKey): CameraPose =>
    subject && key.follow
      ? { ...key, target: mixVec(key.target, subject, key.follow) }
      : key;
  const first = keys[0]!;
  if (frame <= first.frame) return resolve(first);
  for (let i = 1; i < keys.length; i += 1) {
    const b = keys[i]!;
    if (frame <= b.frame) {
      const a = keys[i - 1]!;
      const t = EASE[b.ease ?? "inOutCubic"](
        clamp((frame - a.frame) / (b.frame - a.frame)),
      );
      const pa = resolve(a);
      const pb = resolve(b);
      return {
        target: mixVec(pa.target, pb.target, t),
        yaw: lerp(pa.yaw, pb.yaw, t),
        pitch: lerp(pa.pitch, pb.pitch, t),
        distance: lerp(pa.distance, pb.distance, t),
        fov: lerp(pa.fov, pb.fov, t),
        roll: lerp(pa.roll, pb.roll, t),
      };
    }
  }
  return resolve(keys[keys.length - 1]!);
}

/** A pose part way from `a` to `b`. */
export function mixPose(a: CameraPose, b: CameraPose, t: number): CameraPose {
  return {
    target: mixVec(a.target, b.target, t),
    yaw: lerp(a.yaw, b.yaw, t),
    pitch: lerp(a.pitch, b.pitch, t),
    distance: lerp(a.distance, b.distance, t),
    fov: lerp(a.fov, b.fov, t),
    roll: lerp(a.roll, b.roll, t),
  };
}

/** Where the camera stands for a pose. */
export function eyeOf(pose: CameraPose): Vec3 {
  const { target, yaw, pitch, distance } = pose;
  return {
    x: target.x + distance * Math.cos(pitch) * Math.sin(yaw),
    y: target.y + distance * Math.sin(pitch),
    z: target.z + distance * Math.cos(pitch) * Math.cos(yaw),
  };
}

/** Offsets of the target from decaying shakes, the same at every render. */
export function shakeAt(shakes: readonly Shake[], frame: number): Vec3 {
  let x = 0;
  let y = 0;
  for (const shake of shakes) {
    const age = frame - shake.frame;
    if (age < 0 || age > shake.frames) continue;
    const fall = (1 - age / shake.frames) ** 2;
    x += Math.sin(age * 2.1 + shake.frame) * shake.amplitude * fall;
    y += Math.cos(age * 2.9 + shake.frame * 0.7) * shake.amplitude * fall;
  }
  return { x, y, z: 0 };
}
