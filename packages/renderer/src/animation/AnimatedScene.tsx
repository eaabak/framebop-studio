/**
 * Draws an animation at one frame: sky, layers far to near with their
 * props and characters, and a soft vignette. Nothing is kept between
 * frames; the frame number alone decides the picture.
 */
import type { AnimationSpec } from "@framebop/core";
import { useId } from "react";
import { CharacterView, SpriteCharacterView } from "./character";
import { type Hold, PixiScene } from "./PixiScene";
import { Prop } from "./props";
import { poseAt } from "./rig";
import { cameraAt, itemTransform, layerTransform } from "./scene";
import { hash } from "./timing";

const NO_URLS: Readonly<Record<string, string>> = {};

export type { Hold } from "./PixiScene";

export function AnimatedScene({
  spec,
  mouth,
  frame,
  fps,
  urls = NO_URLS,
  size,
  hold,
}: {
  spec: AnimationSpec;
  /** Mouth openness per output frame, from the narration. */
  mouth: readonly number[];
  frame: number;
  fps: number;
  /** Where each of the animation's pictures loads from, by key. */
  urls?: Readonly<Record<string, string>>;
  /** Pixels of the drawing surface, for PixiJS; the spec's size if unset. */
  size?: { width: number; height: number };
  /** Lets the host wait for pictures to load (the render does). */
  hold?: () => Hold;
}) {
  if (spec.renderer === "pixi") {
    return (
      <PixiScene
        spec={spec}
        urls={urls}
        mouth={mouth}
        frame={frame}
        fps={fps}
        width={size?.width ?? spec.width}
        height={size?.height ?? spec.height}
        hold={hold}
      />
    );
  }
  return (
    <SvgScene spec={spec} mouth={mouth} frame={frame} fps={fps} urls={urls} />
  );
}

function SvgScene({
  spec,
  mouth,
  frame,
  fps,
  urls,
}: {
  spec: AnimationSpec;
  mouth: readonly number[];
  frame: number;
  fps: number;
  urls: Readonly<Record<string, string>>;
}) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const time = (frame * spec.fps) / fps;
  const speech = mouth.length > 0 ? (mouth[frame] ?? 0) : null;
  const camera = cameraAt(spec, time);
  const { width, height } = spec;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid slice"
      style={{ position: "absolute", inset: 0 }}
    >
      <defs>
        <linearGradient id={`${id}sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={spec.sky.top} />
          <stop offset="1" stopColor={spec.sky.bottom} />
        </linearGradient>
        <filter id={`${id}far`}>
          <feComponentTransfer>
            <feFuncR type="linear" slope={0.78} />
            <feFuncG type="linear" slope={0.78} />
            <feFuncB type="linear" slope={0.78} />
          </feComponentTransfer>
        </filter>
        <radialGradient id={`${id}vignette`} cx="0.5" cy="0.45" r="0.75">
          <stop offset="0.6" stopColor="#000000" stopOpacity={0} />
          <stop offset="1" stopColor="#1a0f08" stopOpacity={0.35} />
        </radialGradient>
        {spec.layers
          .filter((layer) => layer.blur > 0)
          .map((layer) => (
            <filter
              key={layer.id}
              id={`${id}blur-${layer.id}`}
              x="-20%"
              y="-20%"
              width="140%"
              height="140%"
            >
              <feGaussianBlur stdDeviation={layer.blur} />
            </filter>
          ))}
      </defs>
      <rect width={width} height={height} fill={`url(#${id}sky)`} />
      {spec.layers.map((layer) => (
        <g
          key={layer.id}
          transform={layerTransform(spec, camera, layer.parallax)}
          filter={layer.blur > 0 ? `url(#${id}blur-${layer.id})` : undefined}
        >
          {layer.items.map((item, index) => {
            const asset = spec.assets[item.asset];
            if (!asset) return null;
            if (item.motion?.kind === "pop" && time < item.motion.at) {
              return null;
            }
            return (
              <g
                key={index}
                transform={itemTransform(item, asset.height, time)}
              >
                <Prop
                  asset={asset}
                  time={time}
                  motion={item.motion}
                  seed={hash(index, layer.id.length)}
                  urls={urls}
                />
              </g>
            );
          })}
          {spec.characters
            .filter((character) => character.layer === layer.id)
            .map((character) => {
              const pose = poseAt(
                character,
                time,
                character.speaksNarration ? speech : null,
              );
              return character.sprites ? (
                <SpriteCharacterView
                  key={character.id}
                  rig={character.sprites}
                  pose={pose}
                  images={spec.images}
                  urls={urls}
                  farFilter={`url(#${id}far)`}
                />
              ) : (
                <CharacterView
                  key={character.id}
                  character={character}
                  pose={pose}
                />
              );
            })}
        </g>
      ))}
      <rect width={width} height={height} fill={`url(#${id}vignette)`} />
    </svg>
  );
}
