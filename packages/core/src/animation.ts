/**
 * The scene configuration of Framebop's 2D animation engine: layers of
 * vector props, articulated characters with timelines of motion clips, and a
 * camera. Everything is evaluated from the frame number alone, so any frame
 * can be rendered on its own and renders the same every time.
 */
import { z } from "zod";
import { IdSchema } from "./domain";
import { AnimationBlueprintSchema } from "./director";
import { LabExperimentSchema } from "./lab";

export { EASES, type Ease, EaseSchema } from "./ease";
import { EaseSchema } from "./ease";

const Frame = z.number().int().min(0).max(100_000);

/** A constant, or keyframes eased from each key to the next. */
export const TrackSchema = z.union([
  z.number(),
  z
    .array(
      z.object({
        frame: Frame,
        value: z.number(),
        ease: EaseSchema.default("inOutSine"),
      }),
    )
    .min(1)
    .max(200),
]);
export type Track = z.infer<typeof TrackSchema>;

/** Repeating or one-off movement of a prop, from the frame number. */
export const PropMotionSchema = z.object({
  kind: z.enum(["sway", "drift", "flutter", "flicker", "fly", "bob", "pop"]),
  amplitude: z.number().default(1),
  /** Frames per cycle. */
  period: z.number().positive().default(60),
  phase: z.number().default(0),
  /** Horizontal speed in pixels per frame, for drift and fly. */
  speed: z.number().default(0),
  /** For pop: the frame it appears. */
  at: Frame.default(0),
});
export type PropMotion = z.infer<typeof PropMotionSchema>;

export const PROP_KINDS = [
  "hill",
  "temple",
  "cloud",
  "building",
  "arch",
  "paving",
  "stall",
  "basket",
  "amphora",
  "brazier",
  "banner",
  "column",
  "plant",
  "bird",
  "cat",
  /** A picture from the animation's images, e.g. a painted background. */
  "image",
] as const;

/** A reusable vector prop: a procedural drawing with its colours and size. */
export const PropAssetSchema = z.object({
  kind: z.enum(PROP_KINDS),
  color: z.string().max(40).default("#c8875a"),
  accent: z.string().max(40).default("#8a3b2a"),
  width: z.number().positive().default(200),
  height: z.number().positive().default(200),
  /** For an image prop: the key of the picture in `images`. */
  image: z.string().max(60).optional(),
});
export type PropAsset = z.infer<typeof PropAssetSchema>;

/**
 * A picture the animation uses: a library asset once it is in a project,
 * named after the file it came from.
 */
export const AnimationImageSchema = z.object({
  name: z.string().min(1).max(120),
  assetId: IdSchema.nullable().default(null),
  /** Size in pixels. */
  width: z.number().int().positive().max(16_384),
  height: z.number().int().positive().max(16_384),
});

const Pixel = z.object({ x: z.number(), y: z.number() });

/**
 * One picture on a bone. `pivot` is the joint it turns around, in the
 * picture's pixels. Limbs are drawn hanging straight down, the torso and
 * head upright, the foot flat and facing right. A limb with a `tip` (the
 * next joint, in pixels) is stretched so its tip meets that joint.
 */
export const SpritePartSchema = z.object({
  image: z.string().max(60),
  pivot: Pixel,
  tip: Pixel.optional(),
});
export type SpritePart = z.infer<typeof SpritePartSchema>;

/** A character drawn from pictures of its parts instead of vector shapes. */
export const SpriteRigSchema = z.object({
  /** Picture pixels per unit of the character's height. */
  pixelsPerHeight: z.number().positive().max(10_000),
  parts: z.object({
    head: SpritePartSchema,
    torso: SpritePartSchema,
    /** Optional skirt of a tunic, hanging from the hips between the legs. */
    skirt: SpritePartSchema.optional(),
    upperArm: SpritePartSchema,
    forearm: SpritePartSchema,
    hand: SpritePartSchema,
    thigh: SpritePartSchema,
    shin: SpritePartSchema,
    foot: SpritePartSchema,
  }),
  /** Eyes and mouths are placed on the head, at points in head units. */
  face: z.object({ eyes: Pixel, mouth: Pixel }),
  eyes: z.object({
    open: SpritePartSchema,
    closed: SpritePartSchema,
    wide: SpritePartSchema,
  }),
  mouths: z.object({
    closed: SpritePartSchema,
    small: SpritePartSchema,
    wide: SpritePartSchema,
    round: SpritePartSchema,
  }),
});
export type SpriteRig = z.infer<typeof SpriteRigSchema>;

export const LayerItemSchema = z.object({
  asset: z.string().max(60),
  x: z.number(),
  y: z.number(),
  scale: z.number().positive().default(1),
  flip: z.boolean().default(false),
  motion: PropMotionSchema.nullable().default(null),
});

export const AnimationLayerSchema = z.object({
  id: z.string().max(40),
  /** 0 stays with the sky, 1 moves with the street, above 1 is foreground. */
  parallax: z.number().min(0).max(2),
  /** Pixels of blur, for a foreground out of focus. */
  blur: z.number().min(0).max(20).default(0),
  items: z.array(LayerItemSchema).max(300),
});
export type AnimationLayer = z.infer<typeof AnimationLayerSchema>;

export const MOTION_CLIPS = [
  "walk",
  "reach",
  "surprise",
  "talk",
  "gesture",
] as const;

/** One use of a motion clip on a character's timeline, in scene frames. */
export const ClipUseSchema = z.object({
  clip: z.enum(MOTION_CLIPS),
  from: Frame,
  to: Frame,
  /** Frames to blend in and out (not used by walk). */
  blend: z.number().int().min(0).max(120).default(8),
  /** Walk: where the character's hips end up. */
  toX: z.number().optional(),
  /** Which arm reaches or gestures. */
  arm: z.enum(["front", "back"]).default("front"),
  /** Reach: the point the hand goes to, in the character's layer. */
  target: z.object({ x: z.number(), y: z.number() }).optional(),
});
export type ClipUse = z.infer<typeof ClipUseSchema>;

export const CharacterStyleSchema = z.object({
  skin: z.string().max(40),
  hair: z.string().max(40),
  tunic: z.string().max(40),
  trim: z.string().max(40),
  belt: z.string().max(40),
  sandal: z.string().max(40),
});

/**
 * How a character walks. The defaults are a stylised cartoon walk; lengths
 * are fractions of the character's height and angles are radians.
 */
export const WalkStyleSchema = z.object({
  /** Rise and fall of the pelvis over each step. */
  bounce: z.number().min(0).max(0.1).default(0.03),
  /** How high the swinging foot lifts. */
  stepHeight: z.number().min(0).max(0.3).default(0.075),
  /** Arm swing either way, and the extra elbow bend as an arm swings forward. */
  armSwing: z.number().min(0).max(1.5).default(0.5),
  elbowBend: z.number().min(0).max(1.5).default(0.42),
  /** Forward lean at full speed. */
  lean: z.number().min(-0.3).max(0.5).default(0.07),
  /** Shoulders and pelvis turning against each other. */
  twist: z.number().min(0).max(0.1).default(0.022),
  /** Toe raised as the heel strikes, and heel raised as the toe pushes off. */
  heelStrike: z.number().min(0).max(0.8).default(0.32),
  toeOff: z.number().min(0).max(1.2).default(0.65),
  /** Frames the head lags behind the body's rise and fall. */
  headLag: z.number().min(0).max(20).default(4),
});
export type WalkStyle = z.infer<typeof WalkStyleSchema>;

export const AnimationCharacterSchema = z.object({
  id: z.string().max(40),
  /** Drawn on top of this layer. */
  layer: z.string().max(40),
  style: CharacterStyleSchema,
  /** Standing height in pixels at scale 1. */
  height: z.number().positive().max(2000),
  facing: z.union([z.literal(1), z.literal(-1)]),
  /** Hips' starting x and the ground's y. */
  x: z.number(),
  groundY: z.number(),
  /** Stride as a fraction of height. */
  stride: z.number().min(0.1).max(0.8).default(0.42),
  walk: WalkStyleSchema.default(WalkStyleSchema.parse({})),
  /** Pictures of its parts; without them it is drawn in vector shapes. */
  sprites: SpriteRigSchema.nullable().default(null),
  /** Whether the mouth follows the scene's narration audio. */
  speaksNarration: z.boolean().default(false),
  timeline: z.array(ClipUseSchema).max(100),
});
export type AnimationCharacter = z.infer<typeof AnimationCharacterSchema>;

export const AnimationSpecSchema = z
  .object({
    version: z.literal(1),
    width: z.number().int().positive().max(8192),
    height: z.number().int().positive().max(8192),
    /**
     * "svg" draws with React SVG; "pixi" draws pictures with PixiJS (WebGL).
     * PixiJS draws only image props and sprite characters. "lab" draws the
     * Framebop Lab experiment in `lab`, and ignores the layers and characters.
     */
    renderer: z.enum(["svg", "pixi", "lab"]).default("svg"),
    /** Frames per second the timeline is written in; any output rate works. */
    fps: z.number().int().min(1).max(120).default(30),
    durationFrames: z.number().int().positive().max(100_000),
    sky: z.object({ top: z.string().max(40), bottom: z.string().max(40) }),
    camera: z.object({
      x: TrackSchema,
      y: TrackSchema,
      zoom: TrackSchema,
      /** Keeps a character in view: x follows its smoothed position instead. */
      follow: z
        .object({
          character: z.string().max(40),
          offsetX: z.number().default(0),
          /** Frames of position averaged, so the camera eases after them. */
          lagFrames: z.number().int().min(1).max(120).default(20),
          minX: z.number().optional(),
          maxX: z.number().optional(),
        })
        .nullable()
        .default(null),
      shakes: z
        .array(
          z.object({
            frame: Frame,
            amplitude: z.number(),
            frames: z.number().int().positive(),
          }),
        )
        .max(20)
        .default([]),
    }),
    assets: z.record(z.string().max(60), PropAssetSchema),
    images: z.record(z.string().max(60), AnimationImageSchema).default({}),
    layers: z.array(AnimationLayerSchema).max(20),
    characters: z.array(AnimationCharacterSchema).max(20),
    /** The experiment the "lab" renderer draws. */
    lab: LabExperimentSchema.nullable().default(null),
    /** The AI Director's plan this animation was built from, to edit again. */
    director: AnimationBlueprintSchema.nullable().default(null),
  })
  .refine(
    (spec) =>
      spec.renderer === "lab" ? spec.lab !== null : spec.layers.length > 0,
    "A Lab animation needs its experiment; any other needs a layer.",
  );
export type AnimationSpec = z.infer<typeof AnimationSpecSchema>;

/** Ready-made animations the engine ships with. */
export const ANIMATION_TEMPLATES = [
  "roman-street",
  "roman-street-sprites",
  "lab-which-path",
] as const;
export const AnimationTemplateSchema = z.enum(ANIMATION_TEMPLATES);
export type AnimationTemplate = z.infer<typeof AnimationTemplateSchema>;
