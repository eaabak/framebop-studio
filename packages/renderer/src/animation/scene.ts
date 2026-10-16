/**
 * The camera and the movement of props, as pure functions of time.
 */
import type { AnimationSpec, LayerItemSchema } from "@framebop/core";
import type { z } from "zod";
import { characterX } from "./rig";
import { EASE, clamp, noise, sample } from "./timing";

const { PI, sin, exp } = Math;

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

/** Where the camera looks, in the coordinates of a layer with parallax 1. */
export function cameraAt(spec: AnimationSpec, time: number): Camera {
  const { camera } = spec;
  let x = sample(camera.x, time);
  const follow = camera.follow;
  const subject = follow
    ? spec.characters.find((character) => character.id === follow.character)
    : undefined;
  if (follow && subject) {
    // The average of where the subject has been: the camera eases after it
    // and settles when it stops, without any state carried between frames.
    const samples = 12;
    let sum = 0;
    for (let i = 0; i < samples; i += 1) {
      sum += characterX(subject, time - (follow.lagFrames * i) / (samples - 1));
    }
    x = sum / samples + follow.offsetX;
    if (follow.minX !== undefined) x = Math.max(follow.minX, x);
    if (follow.maxX !== undefined) x = Math.min(follow.maxX, x);
  }
  let y = sample(camera.y, time);
  for (const shake of camera.shakes) {
    const d = time - shake.frame;
    if (d < 0 || d > shake.frames) continue;
    const fade = exp((-3 * d) / shake.frames) * (1 - d / shake.frames);
    x += shake.amplitude * fade * noise(d * 0.9, 11);
    y += shake.amplitude * fade * noise(d * 0.9, 23);
  }
  return { x, y, zoom: sample(camera.zoom, time) };
}

/** Where a layer is drawn: far layers move and zoom less. */
export function layerPlacement(
  spec: AnimationSpec,
  camera: Camera,
  parallax: number,
): { x: number; y: number; scale: number } {
  const cx = spec.width / 2;
  const cy = spec.height / 2;
  const scale = 1 + (camera.zoom - 1) * parallax;
  const ox = cx + (camera.x - cx) * parallax;
  const oy = cy + (camera.y - cy) * parallax;
  return { x: cx - ox * scale, y: cy - oy * scale, scale };
}

export function layerTransform(
  spec: AnimationSpec,
  camera: Camera,
  parallax: number,
): string {
  const { x, y, scale } = layerPlacement(spec, camera, parallax);
  return `translate(${x} ${y}) scale(${scale})`;
}

type LayerItem = z.infer<typeof LayerItemSchema>;

export interface Placement {
  x: number;
  y: number;
  /** Degrees, clockwise. */
  rotate: number;
  scaleX: number;
  scaleY: number;
}

/** How a prop is moved as a whole: offset, rotation, scale. */
export function itemPlacement(
  item: LayerItem,
  height: number,
  time: number,
): Placement {
  let dx = 0;
  let dy = 0;
  let rotate = 0;
  const m = item.motion;
  if (m) {
    const wave = sin(2 * PI * (time / m.period + m.phase));
    switch (m.kind) {
      case "sway":
        rotate = m.amplitude * wave;
        break;
      case "bob":
        dy = m.amplitude * wave;
        break;
      case "drift":
        dx = m.speed * time;
        break;
      case "fly":
        dx = m.speed * time;
        dy = m.amplitude * wave;
        break;
      case "pop": {
        // Rises out of hiding with a small overshoot.
        const p = clamp((time - m.at) / m.period);
        dy = (1 - EASE.outBack(p)) * height * item.scale * 0.65;
        break;
      }
      case "flutter":
      case "flicker":
        break;
    }
  }
  return {
    x: item.x + dx,
    y: item.y + dy,
    rotate,
    scaleX: item.flip ? -item.scale : item.scale,
    scaleY: item.scale,
  };
}

export function itemTransform(item: LayerItem, height: number, time: number) {
  const p = itemPlacement(item, height, time);
  return `translate(${p.x} ${p.y}) rotate(${p.rotate}) scale(${p.scaleX} ${p.scaleY})`;
}
