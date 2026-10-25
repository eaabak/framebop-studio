/**
 * The declarative scene graph: an animated scene described as data, never
 * as code. Objects are primitives (shapes, lines, arrows, text, groups,
 * trails, glows); their numbers are constants, named parameters, keyframed
 * tracks, or the outputs of a verified solver (such as point-light shadow
 * geometry), so scientific values are computed by Framebop, not written by
 * whoever wrote the scene. The renderer evaluates it from the frame number
 * alone, so every frame is reproducible on its own.
 */
import { z } from "zod";
import { DIRECTION_KEYS } from "./direction";
import { EaseSchema } from "./ease";

const Name = z
  .string()
  .regex(/^[a-zA-Z][\w-]{0,39}$/, "A short name of letters, digits, - and _.");

/** A number: a constant, a parameter's value, or a solver's output. */
export const SceneNumberSchema = z.union([
  z.number(),
  z.object({
    param: Name,
    times: z.number().default(1),
    plus: z.number().default(0),
  }),
  /** "solverId.output", such as "shadow.ratio", times and plus a constant. */
  z.object({
    ref: z.string().regex(/^[a-zA-Z][\w-]*\.[a-zA-Z]\w*$/),
    times: z.number().default(1),
    plus: z.number().default(0),
  }),
]);
export type SceneNumber = z.infer<typeof SceneNumberSchema>;

/** A moment: a frame, or a beat of the timeline and frames after it. */
export const SceneTimeSchema = z.union([
  z.number().int().min(0),
  z.object({ beat: Name, offset: z.number().default(0) }),
]);
export type SceneTime = z.infer<typeof SceneTimeSchema>;

/** A number over time: fixed, or eased from key to key. */
export const SceneTrackSchema = z.union([
  SceneNumberSchema,
  z.object({
    keys: z
      .array(
        z.object({
          at: SceneTimeSchema,
          value: SceneNumberSchema,
          ease: EaseSchema.default("inOutCubic"),
        }),
      )
      .min(1)
      .max(40),
  }),
]);
export type SceneTrack = z.infer<typeof SceneTrackSchema>;

const Point = z.object({ x: SceneTrackSchema, y: SceneTrackSchema });

/** A colour, or a style token: $primary, $secondary, $text, $background. */
const Color = z
  .string()
  .regex(/^(#[0-9a-fA-F]{6}|\$(primary|secondary|text|dim|background)|none)$/);

/**
 * When a part belongs to the scene: only for the art directions listed,
 * by option ("reveal": ["dramatic"]). The composer keeps or drops it.
 */
export const SceneWhenSchema = z
  .partialRecord(
    z.enum(["composition", ...DIRECTION_KEYS]),
    z.array(z.string()).min(1),
  )
  .optional();

const base = {
  id: Name,
  /** A material by name, or none for the primitive's own default. */
  material: Name.optional(),
  opacity: SceneTrackSchema.default(1),
  /** When it shows, fading over `fade` frames at each end. */
  shown: z
    .object({
      from: SceneTimeSchema,
      to: SceneTimeSchema,
      fade: z.number().min(0).max(60).default(8),
    })
    .optional(),
  /** Essential to the explanation: words must not cover it. */
  essential: z.boolean().default(false),
  when: SceneWhenSchema,
  /**
   * How much it follows the camera: 1 with the scene, less for far layers
   * and more for near ones. For decoration only; anything measured stays
   * at 1 (true depth comes from the perspective solver).
   */
  parallax: z.number().min(0).max(2).default(1),
};

/** Text with holes: "{shadow.ratio:1}", "{text.hook}", "{labels.0}", "{phrase.light}". */
const Template = z.string().min(1).max(80);

export type SceneNode =
  | ({ type: "circle"; cx: SceneTrack; cy: SceneTrack; r: SceneTrack } & Base)
  | ({
      type: "rect";
      x: SceneTrack;
      y: SceneTrack;
      w: SceneTrack;
      h: SceneTrack;
      rx: number;
    } & Base)
  | ({
      type: "line";
      x1: SceneTrack;
      y1: SceneTrack;
      x2: SceneTrack;
      y2: SceneTrack;
      width: number;
      dash: number[];
      progress: SceneTrack;
    } & Base)
  | ({
      type: "arrow";
      x1: SceneTrack;
      y1: SceneTrack;
      x2: SceneTrack;
      y2: SceneTrack;
      width: number;
      head: number;
      double: boolean;
    } & Base)
  | ({
      type: "polygon";
      points: { x: SceneTrack; y: SceneTrack }[];
      smooth: boolean;
    } & Base)
  | ({
      type: "path";
      points: { x: SceneTrack; y: SceneTrack }[];
      width: number;
      smooth: boolean;
      progress: SceneTrack;
    } & Base)
  | ({
      type: "text";
      x: SceneTrack;
      y: SceneTrack;
      text: string;
      size: number;
      weight: number;
      align: "start" | "middle" | "end";
    } & Base)
  | ({
      type: "label";
      x: SceneTrack;
      y: SceneTrack;
      text: string;
      size: number;
      filled: boolean;
    } & Base)
  | ({ type: "glow"; cx: SceneTrack; cy: SceneTrack; r: SceneTrack } & Base)
  | ({
      type: "trail";
      x: SceneTrack;
      y: SceneTrack;
      r: number;
      length: number;
      step: number;
    } & Base)
  | ({
      type: "mascot";
      x: SceneTrack;
      y: SceneTrack;
      size: SceneTrack;
      scale: SceneTrack;
      step: SceneTrack;
      look?: SceneTrack | undefined;
      ground: boolean;
    } & Base)
  | ({
      type: "prop";
      kind: (typeof SCENE_PROPS)[number];
      x: SceneTrack;
      y: SceneTrack;
      size: SceneTrack;
      scale: SceneTrack;
      flicker: number;
    } & Base)
  | ({
      type: "silhouette";
      of: string;
      x: SceneTrack;
      y: SceneTrack;
      size: SceneTrack;
      scale: SceneTrack;
      color: string;
      blur: number;
      clipBottom?: SceneTrack | undefined;
    } & Base)
  | ({
      type: "room";
      vanish: { x: SceneTrack; y: SceneTrack };
      wall: {
        left: SceneTrack;
        top: SceneTrack;
        right: SceneTrack;
        bottom: SceneTrack;
      };
      boards: SceneTrack;
      wallMaterial?: string | undefined;
      floorMaterial?: string | undefined;
    } & Base)
  | ({
      type: "lighting";
      x: SceneTrack;
      y: SceneTrack;
      radius: SceneTrack;
      color: string;
      preset?: "even" | "spotlight" | "moody" | undefined;
      flicker: number;
    } & Base)
  | ({
      type: "group";
      x: SceneTrack;
      y: SceneTrack;
      scale: SceneTrack;
      rotation: SceneTrack;
      children: SceneNode[];
    } & Base);
type Base = z.infer<z.ZodObject<typeof base>>;

/** Props a scene can place, drawn by the renderer's own library. */
export const SCENE_PROPS = ["candle", "lantern", "crate"] as const;

export const SceneNodeSchema: z.ZodType<SceneNode> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({
      ...base,
      type: z.literal("circle"),
      cx: SceneTrackSchema,
      cy: SceneTrackSchema,
      r: SceneTrackSchema,
    }),
    z.object({
      ...base,
      type: z.literal("rect"),
      x: SceneTrackSchema,
      y: SceneTrackSchema,
      w: SceneTrackSchema,
      h: SceneTrackSchema,
      rx: z.number().min(0).default(0),
    }),
    z.object({
      ...base,
      type: z.literal("line"),
      x1: SceneTrackSchema,
      y1: SceneTrackSchema,
      x2: SceneTrackSchema,
      y2: SceneTrackSchema,
      width: z.number().min(0.5).max(80).default(4),
      dash: z.array(z.number().min(0)).max(4).default([]),
      /** How much of it is drawn, from its start: 0 to 1. */
      progress: SceneTrackSchema.default(1),
    }),
    z.object({
      ...base,
      type: z.literal("arrow"),
      x1: SceneTrackSchema,
      y1: SceneTrackSchema,
      x2: SceneTrackSchema,
      y2: SceneTrackSchema,
      width: z.number().min(1).max(40).default(5),
      head: z.number().min(4).max(80).default(22),
      double: z.boolean().default(false),
    }),
    z.object({
      ...base,
      type: z.literal("polygon"),
      points: z.array(Point).min(3).max(32),
      smooth: z.boolean().default(false),
    }),
    z.object({
      ...base,
      type: z.literal("path"),
      points: z.array(Point).min(2).max(64),
      width: z.number().min(0.5).max(80).default(4),
      smooth: z.boolean().default(false),
      progress: SceneTrackSchema.default(1),
    }),
    z.object({
      ...base,
      type: z.literal("text"),
      x: SceneTrackSchema,
      y: SceneTrackSchema,
      text: Template,
      size: z.number().min(10).max(220).default(48),
      weight: z.number().min(300).max(900).default(800),
      align: z.enum(["start", "middle", "end"]).default("middle"),
    }),
    z.object({
      ...base,
      type: z.literal("label"),
      x: SceneTrackSchema,
      y: SceneTrackSchema,
      text: Template,
      size: z.number().min(16).max(80).default(30),
      filled: z.boolean().default(false),
    }),
    z.object({
      ...base,
      type: z.literal("glow"),
      cx: SceneTrackSchema,
      cy: SceneTrackSchema,
      r: SceneTrackSchema,
    }),
    z.object({
      ...base,
      type: z.literal("trail"),
      x: SceneTrackSchema,
      y: SceneTrackSchema,
      r: z.number().min(1).max(80).default(10),
      length: z.number().int().min(2).max(240).default(30),
      step: z.number().int().min(1).max(30).default(3),
    }),
    z.object({
      ...base,
      type: z.literal("mascot"),
      /** Where it stands. */
      x: SceneTrackSchema,
      y: SceneTrackSchema,
      /** Its height, times `scale` (a perspective scale, say). */
      size: SceneTrackSchema.default(150),
      scale: SceneTrackSchema.default(1),
      /** Steps walked: each step bobs it once, so walking follows position. */
      step: SceneTrackSchema.default(0),
      /** Where its eyes look, -1 to 1; a slow glance if unset. */
      look: SceneTrackSchema.optional(),
      /** Its own small contact shadow on the ground. */
      ground: z.boolean().default(true),
    }),
    z.object({
      ...base,
      type: z.literal("prop"),
      kind: z.enum(SCENE_PROPS),
      /** Where it stands, its height and a scale on top. */
      x: SceneTrackSchema,
      y: SceneTrackSchema,
      size: SceneTrackSchema.default(120),
      scale: SceneTrackSchema.default(1),
      /** How much a flame flickers, 0 to 1. */
      flicker: z.number().min(0).max(1).default(0.5),
    }),
    z.object({
      ...base,
      type: z.literal("silhouette"),
      /**
       * Another node (a mascot or a prop) drawn as a flat shape at another
       * place and size: its shadow, placed by a solver.
       */
      of: Name,
      x: SceneTrackSchema,
      y: SceneTrackSchema,
      size: SceneTrackSchema,
      scale: SceneTrackSchema.default(1),
      color: Color.default("#000000"),
      blur: z.number().min(0).max(30).default(2),
      /** Hidden below this picture height (where a wall meets the floor). */
      clipBottom: SceneTrackSchema.optional(),
    }),
    z.object({
      ...base,
      type: z.literal("room"),
      /**
       * A back wall facing the camera and a floor running to it, with
       * boards that meet at the vanishing point. The wall's corners are
       * picture positions (from a perspective solver for true depth).
       */
      vanish: Point,
      wall: z.object({
        left: SceneTrackSchema,
        top: SceneTrackSchema,
        right: SceneTrackSchema,
        bottom: SceneTrackSchema,
      }),
      /** Spacing of the floor boards where they meet the wall. */
      boards: SceneTrackSchema.default(120),
      wallMaterial: Name.optional(),
      floorMaterial: Name.optional(),
    }),
    z.object({
      ...base,
      type: z.literal("lighting"),
      /**
       * The light's effect on the whole picture: a pool of light around
       * it and darkness beyond, in the art direction's preset.
       */
      x: SceneTrackSchema,
      y: SceneTrackSchema,
      radius: SceneTrackSchema.default(760),
      color: Color.default("$primary"),
      /** Set by the composer from the direction's lighting. */
      preset: z.enum(["even", "spotlight", "moody"]).optional(),
      flicker: z.number().min(0).max(1).default(0),
    }),
    z.object({
      ...base,
      type: z.literal("group"),
      x: SceneTrackSchema.default(0),
      y: SceneTrackSchema.default(0),
      scale: SceneTrackSchema.default(1),
      rotation: SceneTrackSchema.default(0),
      children: z.array(SceneNodeSchema).max(60),
    }),
  ]),
);

export const SceneMaterialSchema = z.object({
  fill: Color.default("none"),
  stroke: Color.default("none"),
  /** Soft glow around it, in pixels of blur. */
  glow: z.number().min(0).max(80).default(0),
  /** A gradient fill instead of a flat one, along the shape's own box. */
  gradient: z
    .object({
      kind: z.enum(["linear", "radial"]),
      /** Direction of a linear gradient, as a share of the box. */
      from: z.tuple([z.number(), z.number()]).default([0, 0]),
      to: z.tuple([z.number(), z.number()]).default([1, 0]),
      stops: z
        .array(
          z.object({
            offset: z.number().min(0).max(1),
            color: Color,
            opacity: z.number().min(0).max(1).default(1),
          }),
        )
        .min(2)
        .max(6),
    })
    .optional(),
  /** Edge softness, in pixels of blur. */
  blur: z.number().min(0).max(40).default(0),
});
export type SceneMaterial = z.infer<typeof SceneMaterialSchema>;

/** Verified calculations a scene can use; their outputs are named refs. */
export const SceneSolverSchema = z.discriminatedUnion("kind", [
  z.object({
    id: Name,
    /**
     * A point light, an upright object of a height, and a flat screen, all
     * in one plane: the object's shadow on the screen by similar triangles.
     */
    kind: z.literal("pointShadow"),
    light: z.object({ x: SceneNumberSchema, y: SceneNumberSchema }),
    object: z.object({
      x: SceneTrackSchema,
      y: SceneNumberSchema,
      height: SceneNumberSchema,
    }),
    screen: z.object({
      x: SceneNumberSchema,
      top: SceneNumberSchema,
      bottom: SceneNumberSchema,
    }),
    /**
     * The other axis across the screen, for a screen seen face on: where
     * the light and the object are sideways, and the object's width. The
     * shadow's sideways place and width follow by the same ratio.
     */
    lateral: z
      .object({
        light: SceneNumberSchema,
        object: SceneTrackSchema,
        width: SceneNumberSchema,
      })
      .optional(),
  }),
  z.object({
    id: Name,
    /**
     * A pinhole camera: points given as sideways (u), down (v) and depth
     * (z) are placed in the picture, nearer ones larger. Outputs, for each
     * point p: pX and pY in the picture, and pS, its scale there.
     */
    kind: z.literal("perspective"),
    camera: z.object({
      u: SceneTrackSchema.default(0),
      v: SceneTrackSchema.default(0),
      z: SceneTrackSchema,
    }),
    /** Picture pixels per unit at depth one unit: a lens. */
    focal: SceneNumberSchema,
    /** Where the camera's axis meets the picture. */
    center: z
      .object({ x: SceneNumberSchema, y: SceneNumberSchema })
      .default({ x: 540, y: 960 }),
    points: z
      .record(
        Name,
        z.object({
          u: SceneTrackSchema,
          v: SceneTrackSchema,
          z: SceneTrackSchema,
        }),
      )
      .refine((p) => Object.keys(p).length <= 24, "At most 24 points."),
  }),
]);
export type SceneSolver = z.infer<typeof SceneSolverSchema>;

/** A named number the scene exposes for editing, with its limits. */
export const SceneParamSchema = z.object({
  label: z.string().max(40),
  description: z.string().max(160),
  min: z.number(),
  max: z.number(),
  step: z.number().positive(),
  default: z.number(),
  unit: z.string().max(8).default(""),
});

export const SCENE_CUES = [
  "impact",
  "pluck",
  "chord",
  "riser",
  "whoosh",
  "tick",
  "follow",
] as const;

/** A sound at a moment, or (follow) a tone whose pitch follows a value. */
export const SceneCueSchema = z.object({
  at: SceneTimeSchema,
  cue: z.enum(SCENE_CUES),
  /** For riser and follow: when it ends (instead of `value` seconds). */
  until: SceneTimeSchema.optional(),
  /** Hertz for pluck and follow's low end; seconds for riser and follow. */
  value: z.number().default(0),
  amp: z.number().min(0).max(1).default(0.2),
  /** For follow: the ref it follows, mapped from [low, high] to an octave. */
  ref: z.string().optional(),
  low: z.number().default(0),
  high: z.number().default(1),
  when: SceneWhenSchema,
});

export const SceneGraphSchema = z.object({
  version: z.literal(1),
  width: z.number().int().positive().max(4096).default(1080),
  height: z.number().int().positive().max(4096).default(1920),
  fps: z.number().int().min(1).max(60).default(30),
  /** The story's beats in order, with the length of each in seconds. */
  timeline: z
    .array(
      z.object({
        beat: Name,
        seconds: z.number().min(0.5).max(30),
        /** The longest the beat may be planned; past it, nothing moves. */
        max: z.number().min(0.5).max(30).optional(),
      }),
    )
    .min(1)
    .max(8),
  params: z.record(Name, SceneParamSchema).default({}),
  materials: z.record(Name, SceneMaterialSchema).default({}),
  solvers: z.array(SceneSolverSchema).max(4).default([]),
  /** Drawn in order, back to front. */
  nodes: z.array(SceneNodeSchema).min(1).max(80),
  /** Headlines in the kinetic style, by time. */
  headlines: z
    .array(
      z.object({
        text: Template,
        from: SceneTimeSchema,
        to: SceneTimeSchema,
        size: z.number().min(40).max(160).default(108),
        punch: z.number().min(0).max(1).default(0),
        when: SceneWhenSchema,
      }),
    )
    .max(10)
    .default([]),
  camera: z
    .object({
      x: SceneTrackSchema.default(540),
      y: SceneTrackSchema.default(960),
      zoom: SceneTrackSchema.default(1),
      /**
       * The closest the composition can be framed: a wide layout whose
       * words reach the edges caps its zoom, whatever the direction asks.
       */
      maxZoom: z.number().min(1).max(4).default(2),
    })
    .default({ x: 540, y: 960, zoom: 1, maxZoom: 2 }),
  /** Camera moves for some art directions; the first that fits replaces. */
  cameraVariants: z
    .array(
      z.object({
        when: SceneWhenSchema,
        x: SceneTrackSchema.optional(),
        y: SceneTrackSchema.optional(),
        zoom: SceneTrackSchema.optional(),
      }),
    )
    .max(8)
    .default([]),
  /** How headlines look and give way to each other (set by the composer). */
  typography: z
    .object({
      style: z.enum(["clean", "kinetic", "cinematic"]).default("kinetic"),
      transition: z.enum(["cut", "fade", "slide"]).default("fade"),
    })
    .default({ style: "kinetic", transition: "fade" }),
  /** The parameter that sizes the subject, which subject prominence scales. */
  subject: z.object({ param: Name }).optional(),
  cues: z.array(SceneCueSchema).max(40).default([]),
});
export type SceneGraph = z.infer<typeof SceneGraphSchema>;
