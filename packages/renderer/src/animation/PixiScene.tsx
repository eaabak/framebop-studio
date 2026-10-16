/**
 * Draws an animation with PixiJS (WebGL): the same scene graph, poses and
 * camera as the SVG renderer, with pictures as sprites. Nothing animates on
 * its own: the ticker is off, and every frame is drawn once, synchronously,
 * from the frame number.
 *
 * PixiJS draws only image props and sprite characters; vector props and
 * vector characters are left out (the plan refuses such scenes).
 */
import type { AnimationSpec } from "@framebop/core";
import {
  Application,
  BlurFilter,
  Container,
  Graphics,
  Sprite,
  Texture,
} from "pixi.js";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { poseAt } from "./rig";
import { cameraAt, itemPlacement, layerPlacement } from "./scene";
import { spriteOps } from "./sprites";

/** Lets a host (the render) wait while pictures load, or fail on errors. */
export interface Hold {
  release(): void;
  fail(error: Error): void;
}

interface Props {
  spec: AnimationSpec;
  urls: Readonly<Record<string, string>>;
  mouth: readonly number[];
  frame: number;
  fps: number;
  width: number;
  height: number;
  hold?: () => Hold;
}

const FAR_TINT = 0xc8c8c8;

/**
 * Loads a picture for WebGL. Pictures from another origin need CORS; a
 * server without it (a webview's file scheme) is tried once more without.
 */
async function loadTexture(url: string): Promise<Texture> {
  const load = async (cors: boolean) => {
    const image = new Image();
    if (cors) image.crossOrigin = "anonymous";
    image.src = url;
    await image.decode();
    return image;
  };
  const image = await load(true).catch(() => load(false));
  return Texture.from(image, true);
}

/** A vertical gradient as a texture, drawn once with canvas 2D. */
function gradientTexture(top: string, bottom: string): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 256;
  const context = canvas.getContext("2d")!;
  const gradient = context.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, top);
  gradient.addColorStop(1, bottom);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 4, 256);
  return Texture.from(canvas, true);
}

function vignetteTexture(): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(128, 115, 0, 128, 115, 192);
  gradient.addColorStop(0.6, "rgba(0,0,0,0)");
  gradient.addColorStop(1, "rgba(26,15,8,0.35)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);
  return Texture.from(canvas, true);
}

/** The PixiJS objects of one animation, updated in place every frame. */
class World {
  readonly app = new Application();
  private textures = new Map<string, Texture>();
  private owned: Texture[] = [];
  private layers: {
    container: Container;
    parallax: number;
    items: (Sprite | null)[];
    characters: { container: Container; shadow: Graphics; sprites: Sprite[] }[];
  }[] = [];

  constructor(private readonly spec: AnimationSpec) {}

  async init(
    urls: Readonly<Record<string, string>>,
    width: number,
    height: number,
  ) {
    const { spec } = this;
    await this.app.init({
      width,
      height,
      antialias: true,
      autoStart: false,
      preserveDrawingBuffer: true,
      preference: "webgl",
      resolution: 1,
      background: spec.sky.bottom,
    });
    this.app.ticker.stop();
    const keys = Object.keys(spec.images).filter((key) => urls[key]);
    const loaded = await Promise.all(
      keys.map((key) => loadTexture(urls[key]!)),
    );
    keys.forEach((key, i) => this.textures.set(key, loaded[i]!));
    this.owned.push(...loaded);

    // Everything is laid out in the spec's size, then fitted to the output
    // the way the SVG renderer's "slice" does it.
    const fit = Math.max(width / spec.width, height / spec.height);
    const root = new Container();
    root.scale.set(fit);
    root.position.set(
      (width - spec.width * fit) / 2,
      (height - spec.height * fit) / 2,
    );
    this.app.stage.addChild(root);

    const sky = new Sprite(gradientTexture(spec.sky.top, spec.sky.bottom));
    this.owned.push(sky.texture);
    sky.width = spec.width;
    sky.height = spec.height;
    root.addChild(sky);

    for (const layer of spec.layers) {
      const container = new Container();
      if (layer.blur > 0)
        container.filters = [new BlurFilter({ strength: layer.blur })];
      root.addChild(container);
      const items = layer.items.map((item) => {
        const asset = spec.assets[item.asset];
        const texture = asset?.image
          ? this.textures.get(asset.image)
          : undefined;
        if (!asset || asset.kind !== "image" || !texture) return null;
        const sprite = new Sprite(texture);
        sprite.anchor.set(0.5, 1);
        container.addChild(sprite);
        return sprite;
      });
      const characters = spec.characters
        .filter(
          (character) => character.layer === layer.id && character.sprites,
        )
        .map((character) => {
          const shadow = new Graphics();
          container.addChild(shadow);
          const body = new Container();
          container.addChild(body);
          const count = spriteOps(
            character.sprites!,
            poseAt(character, 0),
          ).length;
          const sprites = Array.from({ length: count }, () => {
            const sprite = new Sprite(Texture.EMPTY);
            body.addChild(sprite);
            return sprite;
          });
          return { container: body, shadow, sprites };
        });
      this.layers.push({
        container,
        parallax: layer.parallax,
        items,
        characters,
      });
    }
    const vignette = new Sprite(vignetteTexture());
    this.owned.push(vignette.texture);
    vignette.width = spec.width;
    vignette.height = spec.height;
    root.addChild(vignette);
  }

  get canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  draw(time: number, speech: number | null) {
    const { spec } = this;
    const camera = cameraAt(spec, time);
    spec.layers.forEach((layer, l) => {
      const state = this.layers[l]!;
      const placement = layerPlacement(spec, camera, layer.parallax);
      state.container.position.set(placement.x, placement.y);
      state.container.scale.set(placement.scale);
      layer.items.forEach((item, i) => {
        const sprite = state.items[i];
        const asset = spec.assets[item.asset];
        if (!sprite || !asset) return;
        const hidden = item.motion?.kind === "pop" && time < item.motion.at;
        sprite.visible = !hidden;
        const p = itemPlacement(item, asset.height, time);
        sprite.position.set(p.x, p.y);
        sprite.rotation = (p.rotate * Math.PI) / 180;
        sprite.scale.set(
          (p.scaleX * asset.width) / sprite.texture.width,
          (p.scaleY * asset.height) / sprite.texture.height,
        );
      });
      spec.characters
        .filter(
          (character) => character.layer === layer.id && character.sprites,
        )
        .forEach((character, c) => {
          const parts = state.characters[c]!;
          const pose = poseAt(
            character,
            time,
            character.speaksNarration ? speech : null,
          );
          parts.container.position.set(pose.x, pose.y);
          parts.container.scale.set(pose.facing * pose.height, pose.height);
          parts.shadow
            .clear()
            .ellipse(
              pose.x + pose.hips.x * pose.facing * pose.height,
              pose.y + 0.004 * pose.height,
              0.17 * pose.height,
              0.02 * pose.height,
            )
            .fill({ color: 0x000000, alpha: 0.16 });
          spriteOps(character.sprites!, pose).forEach((op, i) => {
            const sprite = parts.sprites[i]!;
            const texture = this.textures.get(op.image);
            sprite.visible = Boolean(texture);
            if (!texture) return;
            sprite.texture = texture;
            sprite.anchor.set(
              op.pivot.x / texture.width,
              op.pivot.y / texture.height,
            );
            sprite.position.set(op.x, op.y);
            sprite.rotation = op.rotation;
            sprite.scale.set(op.scaleX, op.scaleY);
            sprite.tint = op.far ? FAR_TINT : 0xffffff;
          });
        });
    });
    this.app.renderer.render(this.app.stage);
  }

  destroy() {
    this.app.destroy(true, { children: true });
    for (const texture of this.owned) texture.destroy(true);
    this.textures.clear();
  }
}

export function PixiScene({
  spec,
  urls,
  mouth,
  frame,
  fps,
  width,
  height,
  hold,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [world, setWorld] = useState<World | null>(null);
  const waiting = useRef<Hold | null>(null);

  useEffect(() => {
    let cancelled = false;
    let ready = false;
    const created = new World(spec);
    const pending = hold?.() ?? null;
    waiting.current = pending;
    created
      .init(urls, width, height)
      .then(() => {
        if (cancelled) return created.destroy();
        ready = true;
        host.current?.appendChild(created.canvas);
        created.canvas.style.width = "100%";
        created.canvas.style.height = "100%";
        setWorld(created);
      })
      .catch((error: unknown) => {
        waiting.current = null;
        pending?.fail(
          error instanceof Error ? error : new Error(String(error)),
        );
      });
    return () => {
      cancelled = true;
      setWorld(null);
      waiting.current?.release();
      waiting.current = null;
      if (ready) {
        created.canvas.remove();
        created.destroy();
      }
    };
  }, [spec, urls, width, height, hold]);

  useLayoutEffect(() => {
    if (!world) return;
    const time = (frame * spec.fps) / fps;
    world.draw(time, mouth.length > 0 ? (mouth[frame] ?? 0) : null);
    // The first frame is drawn: the host can take its picture now.
    waiting.current?.release();
    waiting.current = null;
  }, [world, frame, fps, mouth, spec]);

  return <div ref={host} style={{ position: "absolute", inset: 0 }} />;
}
