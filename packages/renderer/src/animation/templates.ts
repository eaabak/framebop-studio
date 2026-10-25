/**
 * Ready-made animations. The Roman street is an original scene drawn
 * entirely from the procedural props and the character rig: a man walks
 * down a market street, stops at a stall, reaches for the figs, is startled
 * by a cat and says a line, while the street goes on around him.
 */
import {
  AnimationCharacterSchema,
  type AnimationSpec,
  AnimationSpecSchema,
  type AnimationTemplate,
  type LayerItemSchema,
} from "@framebop/core";
import type { z } from "zod";
import { TEST_ART } from "../../test-art/manifest";
import { whichPathWins } from "../lab/experiments";
import { hash } from "./timing";

type Item = z.input<typeof LayerItemSchema>;

/** Frames, at 30 per second, of the Roman street's key moments. */
export const ROMAN_STREET = {
  fps: 30,
  durationFrames: 540,
  walk: { from: 15, to: 255, fromX: 250, toX: 1880 },
  reach: { from: 266, to: 344 },
  catPops: 326,
  surprise: { from: 331, to: 400 },
  /** The hero speaks here; the narration's line should start at `from`. */
  talk: { from: 372, to: 480 },
};

const hero: z.input<typeof AnimationCharacterSchema> = {
  id: "marcus",
  layer: "street",
  style: {
    skin: "#e0a882",
    hair: "#2b1d14",
    tunic: "#c9563c",
    trim: "#f0d58a",
    belt: "#6b4423",
    sandal: "#7a4a2a",
  },
  height: 430,
  facing: 1,
  x: ROMAN_STREET.walk.fromX,
  groundY: 905,
  stride: 0.4,
  speaksNarration: true,
  timeline: [
    {
      clip: "walk",
      from: ROMAN_STREET.walk.from,
      to: ROMAN_STREET.walk.to,
      toX: ROMAN_STREET.walk.toX,
      blend: 8,
      arm: "front",
    },
    {
      clip: "reach",
      ...ROMAN_STREET.reach,
      blend: 16,
      arm: "front",
      target: { x: 1992, y: 628 },
    },
    { clip: "surprise", ...ROMAN_STREET.surprise, blend: 6, arm: "front" },
    { clip: "talk", ...ROMAN_STREET.talk, blend: 10, arm: "front" },
  ],
};

const vendor: z.input<typeof AnimationCharacterSchema> = {
  id: "vendor",
  layer: "stall-back",
  style: {
    skin: "#c68e6a",
    hair: "#6a6460",
    tunic: "#5f8a68",
    trim: "#e8d9a8",
    belt: "#4a3020",
    sandal: "#5a3a22",
  },
  height: 400,
  facing: -1,
  x: 2290,
  groundY: 880,
  stride: 0.4,
  speaksNarration: false,
  timeline: [
    { clip: "gesture", from: 60, to: 150, blend: 14, arm: "front" },
    { clip: "surprise", from: 334, to: 384, blend: 8, arm: "front" },
    { clip: "gesture", from: 470, to: 540, blend: 14, arm: "back" },
  ],
};

const passerby: z.input<typeof AnimationCharacterSchema> = {
  id: "passerby",
  layer: "sidewalk",
  style: {
    skin: "#d49a74",
    hair: "#3a2418",
    tunic: "#4f6fa3",
    trim: "#e9e1cf",
    belt: "#2f3f5f",
    sandal: "#5a3a22",
  },
  height: 320,
  facing: -1,
  x: 3000,
  groundY: 842,
  stride: 0.38,
  speaksNarration: false,
  timeline: [
    { clip: "walk", from: 0, to: 540, toX: 380, blend: 8, arm: "front" },
  ],
};

function cityRow(
  from: number,
  to: number,
  y: number,
  seed: number,
  sizes: { width: [number, number]; assets: string[] },
): Item[] {
  const items: Item[] = [];
  let x = from;
  let i = 0;
  while (x < to) {
    const asset =
      sizes.assets[Math.floor(hash(i, seed) * sizes.assets.length)]!;
    items.push({ asset, x, y, scale: 0.9 + hash(i + 50, seed) * 0.25 });
    x +=
      sizes.width[0] + hash(i + 100, seed) * (sizes.width[1] - sizes.width[0]);
    i += 1;
  }
  return items;
}

/** The Roman street, as an animation spec. */
export function romanStreet(): AnimationSpec {
  return AnimationSpecSchema.parse({
    version: 1,
    width: 1920,
    height: 1080,
    fps: ROMAN_STREET.fps,
    durationFrames: ROMAN_STREET.durationFrames,
    sky: { top: "#8cbfe0", bottom: "#f5dcb0" },
    camera: {
      x: 960,
      y: [
        { frame: 0, value: 540 },
        { frame: 250, value: 540, ease: "inOutSine" },
        { frame: 300, value: 610 },
      ],
      zoom: [
        { frame: 0, value: 1, ease: "inOutSine" },
        { frame: 240, value: 1, ease: "inOutSine" },
        { frame: 300, value: 1.24, ease: "outCubic" },
        { frame: 330, value: 1.24, ease: "outCubic" },
        { frame: 345, value: 1.4, ease: "inOutSine" },
        { frame: 480, value: 1.4, ease: "inOutSine" },
        { frame: 540, value: 1.28 },
      ],
      follow: {
        character: "marcus",
        offsetX: 150,
        lagFrames: 24,
        minX: 960,
        maxX: 2150,
      },
      shakes: [{ frame: 333, amplitude: 9, frames: 14 }],
    },
    assets: {
      cloud: { kind: "cloud", color: "#fffaf0", width: 300, height: 110 },
      bird: { kind: "bird", color: "#4a4038", width: 26, height: 12 },
      hill: {
        kind: "hill",
        color: "#a7b88c",
        accent: "#62785a",
        width: 1500,
        height: 260,
      },
      hillFar: {
        kind: "hill",
        color: "#bccaa6",
        accent: "#7d9070",
        width: 1800,
        height: 200,
      },
      temple: {
        kind: "temple",
        color: "#efe6d2",
        accent: "#b0573c",
        width: 380,
        height: 220,
      },
      houseFarA: {
        kind: "building",
        color: "#e2c39b",
        accent: "#bf7457",
        width: 300,
        height: 330,
      },
      houseFarB: {
        kind: "building",
        color: "#d9b18a",
        accent: "#b5654a",
        width: 260,
        height: 400,
      },
      houseFarC: {
        kind: "building",
        color: "#ead2ad",
        accent: "#c27a5c",
        width: 340,
        height: 300,
      },
      houseA: {
        kind: "building",
        color: "#cf9466",
        accent: "#9c4a32",
        width: 420,
        height: 400,
      },
      houseB: {
        kind: "building",
        color: "#bd7d51",
        accent: "#8f3f2b",
        width: 360,
        height: 470,
      },
      houseC: {
        kind: "building",
        color: "#dcab7c",
        accent: "#a5523a",
        width: 460,
        height: 360,
      },
      arch: {
        kind: "arch",
        color: "#d8c3a0",
        accent: "#a88f6c",
        width: 360,
        height: 440,
      },
      banner: {
        kind: "banner",
        color: "#a8322a",
        accent: "#f0d58a",
        width: 90,
        height: 190,
      },
      bannerBlue: {
        kind: "banner",
        color: "#3d5f8f",
        accent: "#f0d58a",
        width: 80,
        height: 170,
      },
      paving: {
        kind: "paving",
        color: "#b9a68a",
        accent: "#8a7860",
        width: 6000,
        height: 420,
      },
      stall: {
        kind: "stall",
        color: "#8a5a36",
        accent: "#c0392b",
        width: 640,
        height: 500,
      },
      basket: {
        kind: "basket",
        color: "#c49a5a",
        accent: "#5b2a4a",
        width: 120,
        height: 78,
      },
      cat: {
        kind: "cat",
        color: "#c77d3a",
        accent: "#b8d86a",
        width: 90,
        height: 86,
      },
      amphora: {
        kind: "amphora",
        color: "#b8653d",
        accent: "#3a2418",
        width: 70,
        height: 150,
      },
      brazier: { kind: "brazier", color: "#3b2f2a", width: 110, height: 150 },
      plant: {
        kind: "plant",
        color: "#5c8a4a",
        accent: "#b8653d",
        width: 120,
        height: 170,
      },
      column: {
        kind: "column",
        color: "#e9dfca",
        accent: "#c9bba0",
        width: 150,
        height: 1300,
      },
      bush: {
        kind: "plant",
        color: "#4d7a3e",
        accent: "#9c5434",
        width: 240,
        height: 330,
      },
    },
    layers: [
      {
        id: "clouds",
        parallax: 0.04,
        items: [
          {
            asset: "cloud",
            x: 300,
            y: 260,
            motion: { kind: "drift", speed: 0.22 },
          },
          {
            asset: "cloud",
            x: 1100,
            y: 190,
            scale: 1.3,
            motion: { kind: "drift", speed: 0.16 },
          },
          {
            asset: "cloud",
            x: 1750,
            y: 300,
            scale: 0.8,
            motion: { kind: "drift", speed: 0.26 },
          },
        ],
      },
      {
        id: "birds",
        parallax: 0.1,
        items: [0, 1, 2].map((i) => ({
          asset: "bird",
          x: -150 - i * 70,
          y: 210 + i * 26,
          scale: 1 - i * 0.12,
          motion: {
            kind: "fly" as const,
            speed: 3.4 - i * 0.2,
            amplitude: 10,
            period: 70,
            phase: i * 0.31,
          },
        })),
      },
      {
        id: "hills",
        parallax: 0.12,
        items: [
          { asset: "hillFar", x: 400, y: 640 },
          { asset: "hillFar", x: 2100, y: 640, scale: 0.9 },
          { asset: "hill", x: 1300, y: 660 },
          { asset: "temple", x: 1330, y: 425 },
        ],
      },
      {
        id: "city-far",
        parallax: 0.45,
        items: cityRow(-500, 4300, 740, 3, {
          width: [250, 330],
          assets: ["houseFarA", "houseFarB", "houseFarC"],
        }),
      },
      {
        id: "street-back",
        parallax: 1,
        items: [
          ...cityRow(-600, 4400, 852, 7, {
            width: [380, 470],
            assets: ["houseA", "houseB", "houseC"],
          }),
          { asset: "arch", x: 1180, y: 852 },
          {
            asset: "banner",
            x: 640,
            y: 700,
            motion: { kind: "flutter", amplitude: 14, period: 75 },
          },
          {
            asset: "bannerBlue",
            x: 2780,
            y: 690,
            motion: { kind: "flutter", amplitude: 12, period: 68, phase: 0.3 },
          },
          {
            asset: "plant",
            x: 900,
            y: 852,
            motion: { kind: "sway", amplitude: 1.5, period: 110 },
          },
          { asset: "amphora", x: 1560, y: 852 },
          { asset: "amphora", x: 1610, y: 852, scale: 0.85 },
          {
            asset: "plant",
            x: 2860,
            y: 852,
            scale: 0.9,
            motion: { kind: "sway", amplitude: 1.5, period: 95, phase: 0.4 },
          },
        ],
      },
      { id: "sidewalk", parallax: 1, items: [] },
      { id: "stall-back", parallax: 1, items: [] },
      {
        id: "street",
        parallax: 1,
        items: [
          { asset: "paving", x: 1800, y: 852 },
          {
            asset: "stall",
            x: 2150,
            y: 880,
            motion: { kind: "flutter", amplitude: 9, period: 64 },
          },
          {
            asset: "cat",
            x: 2016,
            y: 654,
            motion: { kind: "pop", at: ROMAN_STREET.catPops, period: 9 },
          },
          { asset: "basket", x: 2010, y: 700 },
          { asset: "amphora", x: 2380, y: 700, scale: 0.6 },
          { asset: "brazier", x: 2560, y: 908, motion: { kind: "flicker" } },
        ],
      },
      {
        id: "foreground",
        parallax: 1.35,
        blur: 4,
        items: [
          { asset: "column", x: -60, y: 1160 },
          {
            asset: "bush",
            x: 1650,
            y: 1150,
            motion: { kind: "sway", amplitude: 2, period: 120 },
          },
          { asset: "column", x: 3350, y: 1160 },
        ],
      },
    ],
    characters: [passerby, vendor, hero],
  });
}

/**
 * One character walking across a plain street and stopping: the same path
 * and camera every time, for comparing walks.
 */
export function walkTest(): AnimationSpec {
  const street = romanStreet();
  const pick = (ids: string[]) =>
    street.layers.filter((layer) => ids.includes(layer.id));
  return AnimationSpecSchema.parse({
    ...street,
    durationFrames: 240,
    camera: { x: 960, y: 560, zoom: 1, follow: null, shakes: [] },
    layers: [
      ...pick(["clouds", "hills", "city-far"]),
      {
        id: "street",
        parallax: 1,
        items: [{ asset: "paving", x: 1800, y: 852 }],
      },
    ],
    characters: [
      {
        ...hero,
        layer: "street",
        height: 600,
        x: 180,
        groundY: 1010,
        speaksNarration: false,
        timeline: [
          {
            clip: "walk",
            from: 12,
            to: 200,
            toX: 1640,
            blend: 8,
            arm: "front",
          },
        ],
      },
    ],
  });
}

/** Frames, at 30 per second, of the sprite street's key moments. */
export const SPRITE_STREET = {
  fps: 30,
  durationFrames: 270,
  walk: { from: 12, to: 172, fromX: 250, toX: 1160 },
  wave: { from: 182, to: 262 },
  /** Marcus speaks here; the narration's line should start at `from`. */
  talk: { from: 198, to: 250 },
};

type ArtName = keyof typeof TEST_ART;

/** A part of the test art, with the pivot and tip it was drawn with. */
function part(name: ArtName) {
  const art = TEST_ART[name];
  return {
    image: name,
    pivot: art.pivot ?? { x: art.width / 2, y: art.height / 2 },
    ...(art.tip ? { tip: art.tip } : {}),
  };
}

/** A painted layer or prop from the test art, drawn at its own size. */
function picture(name: ArtName) {
  const art = TEST_ART[name];
  return {
    kind: "image" as const,
    image: name,
    width: art.width,
    height: art.height,
  };
}

/**
 * The Roman street drawn with PixiJS from painted layers, with Marcus as a
 * sprite character. All pictures are temporary test art (see test-art/).
 */
export function romanStreetSprites(): AnimationSpec {
  const images = Object.fromEntries(
    Object.entries(TEST_ART).map(([name, art]) => [
      name,
      { name: `${name}.png`, width: art.width, height: art.height },
    ]),
  );
  return AnimationSpecSchema.parse({
    version: 1,
    renderer: "pixi",
    width: 1920,
    height: 1080,
    fps: SPRITE_STREET.fps,
    durationFrames: SPRITE_STREET.durationFrames,
    sky: { top: "#6fa6d6", bottom: "#f6d9a8" },
    camera: {
      x: 960,
      y: [
        { frame: 0, value: 540 },
        { frame: 160, value: 540 },
        { frame: 205, value: 600 },
      ],
      zoom: [
        { frame: 0, value: 1 },
        { frame: 160, value: 1, ease: "inOutSine" },
        { frame: 205, value: 1.18 },
      ],
      follow: {
        character: "marcus",
        offsetX: 160,
        lagFrames: 24,
        minX: 960,
        maxX: 1500,
      },
    },
    images,
    assets: {
      sky: picture("street-sky"),
      cloud: picture("street-cloud"),
      bird: picture("street-bird"),
      far: picture("street-far"),
      mid: picture("street-mid"),
      facade: picture("street-facade"),
      ground: picture("street-ground"),
      column: picture("street-column"),
      plant: picture("street-plant"),
    },
    layers: [
      { id: "sky", parallax: 0, items: [{ asset: "sky", x: 960, y: 1080 }] },
      {
        id: "clouds",
        parallax: 0.04,
        items: [
          {
            asset: "cloud",
            x: 380,
            y: 330,
            motion: { kind: "drift", speed: 0.25 },
          },
          {
            asset: "cloud",
            x: 1450,
            y: 250,
            scale: 0.7,
            motion: { kind: "drift", speed: 0.15 },
          },
          {
            asset: "cloud",
            x: 2150,
            y: 360,
            scale: 0.85,
            motion: { kind: "drift", speed: 0.2 },
          },
        ],
      },
      {
        id: "birds",
        parallax: 0.08,
        items: [0, 1, 2].map((i) => ({
          asset: "bird",
          x: -120 - i * 80,
          y: 230 + i * 30,
          scale: 0.9 - i * 0.15,
          motion: {
            kind: "fly" as const,
            speed: 3 - i * 0.3,
            amplitude: 12,
            period: 50,
            phase: i * 0.3,
          },
        })),
      },
      { id: "far", parallax: 0.15, items: [{ asset: "far", x: 1150, y: 700 }] },
      { id: "mid", parallax: 0.45, items: [{ asset: "mid", x: 1350, y: 770 }] },
      {
        id: "facade",
        parallax: 1,
        items: [{ asset: "facade", x: 1500, y: 848 }],
      },
      {
        id: "street",
        parallax: 1,
        items: [{ asset: "ground", x: 1500, y: 1186 }],
      },
      {
        id: "foreground",
        parallax: 1.35,
        blur: 3,
        items: [
          { asset: "column", x: -60, y: 1190 },
          { asset: "plant", x: 2450, y: 1170, scale: 0.9 },
        ],
      },
    ],
    characters: [
      {
        ...hero,
        layer: "street",
        height: 560,
        x: SPRITE_STREET.walk.fromX,
        groundY: 1000,
        speaksNarration: true,
        sprites: {
          pixelsPerHeight: 1000,
          parts: {
            head: part("marcus-head"),
            torso: part("marcus-torso"),
            skirt: part("marcus-skirt"),
            upperArm: part("marcus-upper-arm"),
            forearm: part("marcus-forearm"),
            hand: part("marcus-hand"),
            thigh: part("marcus-thigh"),
            shin: part("marcus-shin"),
            foot: part("marcus-foot"),
          },
          face: { eyes: { x: 0.06, y: -0.11 }, mouth: { x: 0.072, y: -0.054 } },
          eyes: {
            open: part("marcus-eye-open"),
            closed: part("marcus-eye-closed"),
            wide: part("marcus-eye-wide"),
          },
          mouths: {
            closed: part("marcus-mouth-closed"),
            small: part("marcus-mouth-small"),
            wide: part("marcus-mouth-wide"),
            round: part("marcus-mouth-round"),
          },
        },
        timeline: [
          {
            clip: "walk",
            from: SPRITE_STREET.walk.from,
            to: SPRITE_STREET.walk.to,
            toX: SPRITE_STREET.walk.toX,
            blend: 8,
            arm: "front",
          },
          { clip: "gesture", ...SPRITE_STREET.wave, blend: 12, arm: "front" },
          { clip: "talk", ...SPRITE_STREET.talk, blend: 8, arm: "back" },
        ],
      },
    ],
  });
}

export function animationTemplate(name: AnimationTemplate): AnimationSpec {
  switch (name) {
    case "roman-street":
      return romanStreet();
    case "roman-street-sprites":
      return romanStreetSprites();
    case "lab-which-path":
      return whichPathWins();
  }
}
