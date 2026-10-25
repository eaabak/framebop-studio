/**
 * Why does a shadow grow as an object nears the light? A scene graph, as
 * data: a point light, an object that moves towards it and back, a screen,
 * and everything about the shadow (its edges, the rays, the size readout)
 * bound to the pointShadow solver, so no shadow position is written by
 * hand. Edit the parameters, timeline or materials to change the video.
 */
import {
  type SceneGraph,
  SceneGraphSchema,
  type SceneTrackSchema,
} from "@framebop/core";
import type { z } from "zod";

const P = (param: string, plus = 0) => ({ param, plus });
const S = (output: string, plus = 0) => ({ ref: `shadow.${output}`, plus });
const at = (beat: string, offset = 0) => ({ beat, offset });
type Track = z.input<typeof SceneTrackSchema>;

/**
 * The science both compositions share: where the light, the object and the
 * screen are along the line from the light, and the object's size. The
 * diagram lays that line across the picture; the stage runs it into it.
 */
const SHARED = {
  lightX: {
    label: "Light position",
    description: "Where the light is along the line to the screen",
    min: 110,
    max: 320,
    step: 5,
    default: 170,
    unit: "px",
  },
  screenX: {
    label: "Screen position",
    description: "Where the screen (or wall) is along that line",
    min: 760,
    max: 940,
    step: 5,
    default: 880,
    unit: "px",
  },
  objectHeight: {
    label: "Object size",
    description: "Height of the moving object",
    min: 60,
    max: 200,
    step: 5,
    default: 105,
    unit: "px",
  },
  startX: {
    label: "Start",
    description: "Where the object starts, far from the light",
    min: 420,
    max: 820,
    step: 5,
    default: 740,
    unit: "px",
  },
  endX: {
    label: "Closest",
    description: "How close the object comes to the light",
    min: 240,
    max: 520,
    step: 5,
    default: 300,
    unit: "px",
  },
  backX: {
    label: "Back to",
    description: "Where it moves back to in the explanation",
    min: 300,
    max: 800,
    step: 5,
    default: 500,
    unit: "px",
  },
};

/** The object's way along the line: in, a pause, part way back, home. */
const along: Track = {
  keys: [
    { at: 0, value: P("startX") },
    { at: at("experiment", 6), value: P("startX") },
    { at: at("reveal", -6), value: P("endX"), ease: "inOutSine" },
    { at: at("explanation", 10), value: P("endX") },
    { at: at("closing", -6), value: P("backX"), ease: "inOutSine" },
    { at: at("closing", 50), value: P("startX"), ease: "inOutCubic" },
  ],
};

const graph: z.input<typeof SceneGraphSchema> = {
  version: 1,
  timeline: [
    { beat: "hook", seconds: 2, max: 2.4 },
    { beat: "experiment", seconds: 6, max: 8 },
    { beat: "reveal", seconds: 2, max: 2.6 },
    { beat: "explanation", seconds: 4, max: 6 },
    { beat: "closing", seconds: 2.5, max: 3.2 },
  ],
  params: {
    ...SHARED,
    lightY: {
      label: "Light height",
      description: "Height of the light and of the object's centre",
      min: 900,
      max: 1140,
      step: 5,
      default: 1030,
      unit: "px",
    },
  },
  materials: {
    backdrop: {
      gradient: {
        kind: "linear",
        from: [0, 0],
        to: [0, 1],
        stops: [
          { offset: 0, color: "#0B0D12" },
          { offset: 0.5, color: "#141A26" },
          { offset: 1, color: "#0B0D12" },
        ],
      },
    },
    floor: {
      gradient: {
        kind: "linear",
        from: [0, 0],
        to: [0, 1],
        stops: [
          { offset: 0, color: "#1A2030" },
          { offset: 1, color: "#0B0D12" },
        ],
      },
    },
    wall: {
      gradient: {
        kind: "linear",
        from: [0, 0],
        to: [1, 0],
        stops: [
          { offset: 0, color: "#3A4253" },
          { offset: 1, color: "#1C222E" },
        ],
      },
    },
    lightCone: {
      gradient: {
        kind: "linear",
        from: [0, 0.5],
        to: [1, 0.5],
        stops: [
          { offset: 0, color: "$primary", opacity: 0.32 },
          { offset: 1, color: "$primary", opacity: 0.08 },
        ],
      },
    },
    flat: { fill: "#0D1017" },
    umbra: { fill: "#000000", blur: 2 },
    shadow: { fill: "#05060A", blur: 1.5 },
    ray: { stroke: "$primary", glow: 4 },
    bulb: { fill: "#FFF4E0", glow: 16 },
    warm: { fill: "$primary" },
    object: {
      gradient: {
        kind: "linear",
        from: [0, 0],
        to: [1, 1],
        stops: [
          { offset: 0, color: "$secondary" },
          { offset: 1, color: "#0A6F69" },
        ],
      },
      glow: 0,
    },
    cool: { fill: "$secondary" },
    ink: { fill: "$text" },
    dim: { fill: "$dim" },
  },
  solvers: [
    {
      id: "shadow",
      kind: "pointShadow",
      light: { x: P("lightX"), y: P("lightY") },
      object: {
        // Towards the light through the experiment, part way back for the
        // explanation, and home again for the loop.
        x: along,
        y: P("lightY"),
        height: P("objectHeight"),
      },
      screen: { x: P("screenX"), top: 660, bottom: 1400 },
    },
  ],
  nodes: [
    // Flat: one quiet tone. Layered and deep: a lit band behind the scene.
    {
      id: "backdrop",
      type: "rect",
      x: -200,
      y: -200,
      w: 1480,
      h: 2320,
      material: "flat",
      when: { depth: ["flat"] },
    },
    {
      id: "backdropLit",
      type: "rect",
      x: -200,
      y: -200,
      w: 1480,
      h: 2320,
      material: "backdrop",
      when: { depth: ["layered", "deep"] },
    },
    {
      id: "floor",
      type: "rect",
      x: 0,
      y: 1400,
      w: 1080,
      h: 520,
      material: "floor",
    },
    // The light falls on the screen; the object's umbra lies behind it.
    {
      id: "cone",
      type: "polygon",
      material: "lightCone",
      points: [
        { x: S("lightX"), y: S("lightY") },
        { x: S("screenX"), y: 660 },
        { x: S("screenX"), y: 1400 },
      ],
    },
    {
      id: "umbra",
      type: "polygon",
      material: "umbra",
      opacity: 0.55,
      points: [
        { x: S("objX"), y: S("objTop") },
        { x: S("screenX"), y: S("shadowTop") },
        { x: S("screenX"), y: S("shadowBottom") },
        { x: S("objX"), y: S("objBottom") },
      ],
    },
    {
      id: "screen",
      type: "rect",
      material: "wall",
      x: S("screenX"),
      y: 660,
      w: 34,
      h: 740,
      rx: 4,
      essential: true,
    },
    {
      id: "shadow",
      type: "rect",
      material: "shadow",
      x: S("screenX"),
      y: S("shadowTop"),
      w: 12,
      h: S("shadowHeight"),
      rx: 3,
      essential: true,
    },
    // The two rays that make the shadow's edges.
    {
      id: "rayTop",
      type: "line",
      material: "ray",
      width: 3,
      dash: [14, 10],
      x1: S("lightX"),
      y1: S("lightY"),
      x2: S("screenX"),
      y2: S("shadowTop"),
      opacity: {
        keys: [
          { at: 0, value: 0 },
          { at: 8, value: 0.9 },
        ],
      },
      // Drawn from the light outwards, so the eye follows the ray.
      progress: {
        keys: [
          { at: 0, value: 0 },
          { at: 22, value: 1, ease: "outCubic" },
        ],
      },
    },
    {
      id: "rayBottom",
      type: "line",
      material: "ray",
      width: 3,
      dash: [14, 10],
      x1: S("lightX"),
      y1: S("lightY"),
      x2: S("screenX"),
      y2: S("shadowBottom"),
      opacity: {
        keys: [
          { at: 0, value: 0 },
          { at: 8, value: 0.9 },
        ],
      },
      // Drawn from the light outwards, so the eye follows the ray.
      progress: {
        keys: [
          { at: 0, value: 0 },
          { at: 22, value: 1, ease: "outCubic" },
        ],
      },
    },
    {
      id: "path",
      type: "trail",
      material: "cool",
      x: S("objX"),
      y: P("lightY"),
      r: 7,
      length: 60,
      step: 6,
      shown: { from: at("experiment"), to: at("reveal", 30) },
    },
    {
      id: "glow",
      type: "glow",
      material: "warm",
      cx: S("lightX"),
      cy: S("lightY"),
      r: {
        keys: [
          { at: 0, value: 40 },
          { at: 14, value: 220, ease: "outBack" },
        ],
      },
    },
    {
      id: "bulb",
      type: "circle",
      material: "bulb",
      cx: S("lightX"),
      cy: S("lightY"),
      r: 26,
      essential: true,
    },
    {
      id: "object",
      type: "rect",
      material: "object",
      x: { ref: "shadow.objX" },
      y: S("objTop"),
      w: 30,
      h: S("objHeight"),
      rx: 10,
      essential: true,
    },
    // A dramatic reveal flares the light as the size lands.
    {
      id: "flare",
      type: "glow",
      material: "warm",
      cx: S("lightX"),
      cy: S("lightY"),
      when: { reveal: ["dramatic"] },
      r: {
        keys: [
          { at: at("reveal", -4), value: 220 },
          { at: at("reveal", 6), value: 360, ease: "outCubic" },
          { at: at("reveal", 40), value: 220, ease: "inOutSine" },
        ],
      },
      opacity: {
        keys: [
          { at: at("reveal", -4), value: 0 },
          { at: at("reveal", 6), value: 0.9 },
          { at: at("reveal", 40), value: 0 },
        ],
      },
    },
    // The light's effect on the picture, in the direction's lighting.
    {
      id: "lighting",
      type: "lighting",
      x: S("lightX"),
      y: S("lightY"),
      radius: 980,
    },
    // Labels that move with what they name.
    {
      id: "lightLabel",
      type: "label",
      material: "warm",
      text: "{phrase.light}",
      x: S("lightX"),
      y: P("lightY", -100),
      shown: { from: 8, to: at("closing", 40) },
    },
    {
      id: "objectLabel",
      type: "label",
      material: "cool",
      text: "{labels.0}",
      x: S("objX"),
      y: S("objBottom", 60),
      shown: { from: 14, to: at("reveal") },
    },
    {
      id: "size",
      type: "arrow",
      material: "ink",
      double: true,
      width: 4,
      head: 18,
      x1: 990,
      y1: S("shadowTop"),
      x2: 990,
      y2: S("shadowBottom"),
      shown: { from: at("experiment"), to: at("closing", 30) },
    },
    {
      id: "sizeLabel",
      type: "label",
      material: "ink",
      text: "{labels.1} ×{shadow.ratio:1}",
      x: S("screenX", -185),
      y: S("shadowTop", -56),
      size: 32,
      filled: false,
      shown: { from: at("experiment"), to: at("closing", 30) },
    },
    // The why: the two distances that set the size.
    {
      id: "dArrow",
      type: "arrow",
      material: "cool",
      double: true,
      width: 4,
      head: 16,
      x1: S("lightX"),
      y1: 1452,
      x2: S("objX"),
      y2: 1452,
      shown: { from: at("explanation"), to: at("closing", 20) },
    },
    {
      id: "dLabel",
      type: "label",
      material: "cool",
      text: "d",
      x: S("midD"),
      y: 1452,
      filled: true,
      size: 30,
      shown: { from: at("explanation", 6), to: at("closing", 20) },
    },
    {
      id: "DArrow",
      type: "arrow",
      material: "warm",
      double: true,
      width: 4,
      head: 16,
      x1: S("lightX"),
      y1: 1512,
      x2: S("screenX"),
      y2: 1512,
      shown: { from: at("explanation", 10), to: at("closing", 20) },
    },
    {
      id: "DLabel",
      type: "label",
      material: "warm",
      text: "D",
      x: S("midScreen"),
      y: 1512,
      filled: true,
      size: 30,
      shown: { from: at("explanation", 14), to: at("closing", 20) },
    },
    {
      id: "rule",
      type: "label",
      material: "ink",
      text: "{labels.1} = {labels.0} × D ÷ d",
      x: 540,
      // Under the headline, however many lines it wraps to, and fixed to
      // the screen as the headline is (out of the camera's moves).
      y: { ref: "layout.headlineBottom", plus: 44 },
      parallax: 0,
      size: 32,
      filled: false,
      shown: { from: at("explanation", 20), to: at("closing", 2) },
    },
    { id: "mascot", type: "mascot", x: 110, y: 1395, size: 120 },
  ],
  headlines: [
    {
      text: "{text.hook}",
      from: 1,
      to: at("experiment", 30),
      size: 112,
      punch: 0.4,
    },
    {
      text: "{labels.1} ×{shadow.ratio:1}",
      from: at("reveal"),
      to: at("explanation"),
      size: 118,
      punch: 1,
    },
    {
      text: "{text.explanation}",
      from: at("explanation", 4),
      to: at("closing", 2),
      size: 100,
    },
    {
      text: "{text.closing}",
      from: at("closing", 4),
      to: at("closing", 72),
      size: 104,
      punch: 0.4,
    },
  ],
  subject: { param: "objectHeight" },
  camera: {
    // Wide: its words reach both sides, so it is never framed much closer.
    maxZoom: 1.09,
    x: 540,
    y: {
      keys: [
        { at: 0, value: 990 },
        { at: at("reveal"), value: 1000, ease: "inOutSine" },
        { at: at("closing", 60), value: 990 },
      ],
    },
    zoom: {
      keys: [
        { at: 0, value: 1 },
        { at: at("reveal"), value: 1.04, ease: "inOutSine" },
        { at: at("closing", 60), value: 1 },
      ],
    },
  },
  cameraVariants: [
    {
      // A dramatic reveal punches in on the result, then settles.
      when: { reveal: ["dramatic"] },
      zoom: {
        keys: [
          { at: 0, value: 1 },
          { at: at("reveal", -6), value: 1.03, ease: "inOutSine" },
          { at: at("reveal", 6), value: 1.1, ease: "outCubic" },
          { at: at("explanation"), value: 1.04, ease: "inOutSine" },
          { at: at("closing", 60), value: 1 },
        ],
      },
    },
  ],
  cues: [
    { at: 0, cue: "impact", amp: 0.32 },
    {
      at: at("reveal", -40),
      until: at("reveal"),
      cue: "riser",
      amp: 0.12,
      when: { reveal: ["dramatic"] },
    },
    { at: 6, cue: "pluck", value: 784, amp: 0.1 },
    // The tone rises as the shadow grows: the sound follows the solver.
    {
      at: at("experiment", 6),
      until: at("reveal"),
      cue: "follow",
      ref: "shadow.ratio",
      low: 1,
      high: 6,
      value: 196,
      amp: 0.08,
    },
    { at: at("reveal"), cue: "chord", value: 523.25, amp: 0.1 },
    { at: at("reveal"), cue: "impact", amp: 0.36 },
    { at: at("explanation"), cue: "whoosh", amp: 0.06 },
    { at: at("explanation", 6), cue: "pluck", value: 659.25, amp: 0.08 },
    { at: at("explanation", 14), cue: "pluck", value: 880, amp: 0.08 },
    { at: at("closing", 4), cue: "chord", value: 392, amp: 0.08 },
  ],
};

export function shadowScene(): SceneGraph {
  return SceneGraphSchema.parse(graph);
}

/*
 * The same science, staged: a dark room seen from the front, a lantern low
 * on the floor, and the Framebop mascot walking towards it while its shadow
 * towers on the back wall. The line from the light to the wall runs into
 * the picture (depth), so the shadow solver's x is depth here, with the
 * same parameters as the diagram. A perspective camera places every point;
 * the wall shadow is the mascot's own outline scaled about the light by
 * the solver's ratio, and the part of it below the wall's foot lies on the
 * floor as a strip running back from its feet.
 */

/** Height of the floor below the camera, and of the light above the floor. */
const FLOOR = 220;
const LIGHT_V = FLOOR - 24;
/** Sideways place of the light; the mascot walks to just right of it. */
const LIGHT_U = -150;
const C = (output: string, plus = 0, times = 1) => ({
  ref: `cam.${output}`,
  plus,
  times,
});
const walkU: Track = {
  keys: [
    { at: 0, value: 80 },
    { at: at("experiment", 6), value: 80 },
    { at: at("reveal", -6), value: -125, ease: "inOutSine" },
    { at: at("explanation", 10), value: -125 },
    { at: at("closing", -6), value: 0, ease: "inOutSine" },
    { at: at("closing", 50), value: 80, ease: "inOutCubic" },
  ],
};
const onWall = (u: Track, v: Track) => ({ u, v, z: P("screenX") });
const onFloor = (u: Track, z: Track) => ({ u, v: FLOOR, z });

const stage: z.input<typeof SceneGraphSchema> = {
  version: 1,
  timeline: graph.timeline,
  params: SHARED,
  subject: { param: "objectHeight" },
  materials: {
    wall: {
      gradient: {
        kind: "linear",
        from: [0, 0],
        to: [0, 1],
        stops: [
          { offset: 0, color: "#0E1016" },
          { offset: 0.7, color: "#272B36" },
          { offset: 1, color: "#30333C" },
        ],
      },
    },
    floor: {
      gradient: {
        kind: "linear",
        from: [0, 0],
        to: [0, 1],
        stops: [
          { offset: 0, color: "#3A2E24" },
          { offset: 1, color: "#120E0B" },
        ],
      },
    },
    shade: { fill: "#030305", blur: 3 },
    ray: { stroke: "$primary", glow: 5 },
    lightCone: {
      gradient: {
        kind: "linear",
        from: [0, 1],
        to: [1, 0],
        stops: [
          { offset: 0, color: "$primary", opacity: 0.3 },
          { offset: 1, color: "$primary", opacity: 0.04 },
        ],
      },
    },
    warm: { fill: "$primary" },
    cool: { fill: "$secondary" },
    ink: { fill: "$text" },
    near: { fill: "#07080B", blur: 10 },
  },
  solvers: [
    {
      id: "shadow",
      kind: "pointShadow",
      light: { x: P("lightX"), y: LIGHT_V },
      object: {
        x: along,
        // Standing on the floor: its centre half its height above it.
        y: { param: "objectHeight", times: -0.5, plus: FLOOR },
        height: P("objectHeight"),
      },
      // The wall rises far above the picture; below its foot is floor.
      screen: { x: P("screenX"), top: -1400, bottom: 4000 },
      lateral: {
        light: LIGHT_U,
        object: walkU,
        width: { param: "objectHeight", times: 0.78 },
      },
    },
    {
      id: "cam",
      kind: "perspective",
      // A slow dolly in as it walks, back a little to show the rays, home
      // for the loop; a slight rise and drift that follow the mascot.
      camera: {
        u: {
          keys: [
            { at: 0, value: 20 },
            { at: at("reveal"), value: -20, ease: "inOutSine" },
            { at: at("closing", 60), value: 20, ease: "inOutSine" },
          ],
        },
        v: {
          keys: [
            { at: 0, value: 0 },
            { at: at("reveal"), value: 40, ease: "inOutSine" },
            { at: at("closing", 60), value: 0, ease: "inOutSine" },
          ],
        },
        z: {
          keys: [
            { at: 0, value: -760 },
            { at: at("experiment"), value: -740, ease: "inOutSine" },
            { at: at("reveal", -6), value: -580, ease: "inOutSine" },
            { at: at("explanation", 10), value: -600, ease: "inOutSine" },
            { at: at("explanation", 70), value: -660, ease: "inOutSine" },
            { at: at("closing", 60), value: -760, ease: "inOutSine" },
          ],
        },
      },
      focal: 1580,
      // Low in the picture: the wall rises over the room, the floor stays
      // a strip, so the frame is room and shadow rather than empty floor.
      center: { x: 540, y: 1090 },
      points: {
        bulb: { u: LIGHT_U, v: LIGHT_V, z: P("lightX") },
        lamp: onFloor(LIGHT_U, P("lightX")),
        hero: onFloor(S("objU"), S("objX")),
        shade: onWall(S("shadowU"), S("shadowBottom")),
        shadeTop: onWall(S("shadowU"), S("shadowTop")),
        shadeL: onWall(S("shadowLeft"), S("shadowMidY")),
        shadeR: onWall(S("shadowRight"), S("shadowMidY")),
        footL: onFloor(S("objLeft"), S("objX")),
        footR: onFloor(S("objRight"), S("objX")),
        baseL: onWall(S("shadowLeft"), FLOOR),
        baseR: onWall(S("shadowRight"), FLOOR),
        wallTL: onWall(-760, -1400),
        wallBR: onWall(760, FLOOR),
        // Along the top ray, light to subject is d and light to wall is D
        // (similar triangles hold on every ray), so d and D are marked on it.
        dMid: { u: S("midU"), v: S("midTopY"), z: S("midD") },
        near: onFloor(-250, 0),
      },
    },
  ],
  nodes: [
    {
      id: "room",
      type: "room",
      vanish: { x: 540, y: 1090 },
      wall: {
        left: C("wallTLX"),
        top: C("wallTLY"),
        right: C("wallBRX"),
        bottom: C("wallBRY"),
      },
      boards: C("wallBRS", 0, 120),
      wallMaterial: "wall",
      floorMaterial: "floor",
    },
    // Atmosphere: the light's haze in the air, for layered and deep depth.
    {
      id: "haze",
      type: "glow",
      material: "warm",
      cx: C("bulbX"),
      cy: C("bulbY", -320),
      r: C("bulbS", 0, 300),
      opacity: 0.16,
      when: { depth: ["layered", "deep"] },
    },
    // Deep: something close to the camera, out of focus, that the dolly
    // moves past faster than the room: real parallax from the camera.
    {
      id: "nearCrate",
      type: "prop",
      kind: "crate",
      material: "near",
      x: C("nearX"),
      y: C("nearY"),
      size: 150,
      scale: C("nearS"),
      when: { depth: ["deep"] },
    },
    // A dramatic reveal flares the light, under the shadows it casts.
    {
      id: "flare",
      type: "glow",
      material: "warm",
      cx: C("bulbX"),
      cy: C("bulbY"),
      when: { reveal: ["dramatic"] },
      r: {
        keys: [
          { at: at("reveal", -4), value: 160 },
          { at: at("reveal", 6), value: 340, ease: "outCubic" },
          { at: at("reveal", 44), value: 160, ease: "inOutSine" },
        ],
      },
      opacity: {
        keys: [
          { at: at("reveal", -4), value: 0 },
          { at: at("reveal", 6), value: 0.6 },
          { at: at("reveal", 44), value: 0 },
        ],
      },
    },
    // The light falls on the room: a shadow is where it does not reach,
    // so shadows are drawn over it, and what it lights over them.
    {
      id: "lighting",
      type: "lighting",
      x: C("bulbX"),
      y: C("bulbY", -200),
      radius: C("bulbS", 0, 520),
      flicker: 0.6,
    },
    // The shadow: on the wall above its foot, on the floor below it.
    {
      id: "floorShadow",
      type: "polygon",
      material: "shade",
      opacity: 0.72,
      points: [
        { x: C("footLX"), y: C("footLY") },
        { x: C("footRX"), y: C("footRY") },
        { x: C("baseRX"), y: C("baseRY") },
        { x: C("baseLX"), y: C("baseLY") },
      ],
    },
    {
      id: "wallShadow",
      type: "silhouette",
      of: "hero",
      x: C("shadeX"),
      y: C("shadeY"),
      size: S("shadowHeight"),
      scale: C("shadeS"),
      clipBottom: C("wallBRY"),
      color: "#030305",
      blur: 3,
      opacity: 0.84,
      essential: true,
    },
    // The light geometry, revealed in the explanation: a fan of rays from
    // the light past the mascot's top and sides to the shadow's.
    {
      id: "cone",
      type: "polygon",
      material: "lightCone",
      points: [
        { x: C("bulbX"), y: C("bulbY") },
        { x: C("shadeLX"), y: C("shadeLY") },
        { x: C("shadeTopX"), y: C("shadeTopY") },
        { x: C("shadeRX"), y: C("shadeRY") },
      ],
      shown: { from: at("explanation", 8), to: at("closing", 10), fade: 12 },
    },
    ...(["shadeTop", "shadeL", "shadeR"] as const).map((end, i) => ({
      id: `ray${i}`,
      type: "line" as const,
      material: "ray",
      width: 4,
      dash: [16, 11],
      x1: C("bulbX"),
      y1: C("bulbY"),
      x2: C(`${end}X`),
      y2: C(`${end}Y`),
      progress: {
        keys: [
          { at: at("explanation", 2 + i * 5), value: 0 },
          { at: at("explanation", 26 + i * 5), value: 1, ease: "outCubic" },
        ],
      },
      shown: { from: at("explanation"), to: at("closing", 10), fade: 6 },
    })),
    {
      id: "hero",
      type: "mascot",
      x: C("heroX"),
      y: C("heroY"),
      size: P("objectHeight"),
      scale: C("heroS"),
      // A step for each 40 px walked, so it walks as fast as it moves.
      step: { ref: "shadow.objX", times: 1 / 40 },
      ground: false,
      // It watches the light, glances back at its shadow, then the light.
      look: {
        keys: [
          { at: 0, value: -0.3 },
          { at: at("experiment"), value: -0.7 },
          { at: at("reveal"), value: -0.7 },
          { at: at("reveal", 12), value: 0.8, ease: "outBack" },
          { at: at("explanation", 30), value: 0.8 },
          { at: at("explanation", 50), value: -0.4 },
          { at: at("closing", 40), value: -0.3 },
        ],
      },
      essential: true,
    },
    {
      id: "glow",
      type: "glow",
      material: "warm",
      cx: C("bulbX"),
      cy: C("bulbY"),
      r: C("bulbS", 0, 58),
    },
    {
      id: "lantern",
      type: "prop",
      kind: "lantern",
      x: C("lampX"),
      y: C("lampY"),
      size: 70,
      scale: C("lampS"),
      flicker: 0.6,
      essential: true,
    },
    {
      id: "lightLabel",
      type: "label",
      material: "warm",
      text: "{phrase.light}",
      x: C("lampX"),
      y: C("lampY", -190),
      shown: { from: 8, to: at("experiment", 40) },
    },
    {
      id: "objectLabel",
      type: "label",
      material: "cool",
      text: "{labels.0}",
      x: C("heroX"),
      y: C("heroY", 44),
      shown: { from: 14, to: at("experiment", 60) },
    },
    {
      id: "shadowLabel",
      type: "label",
      material: "ink",
      text: "{labels.1}",
      x: C("shadeTopX"),
      y: C("shadeTopY", -46),
      shown: { from: at("experiment", 40), to: at("reveal") },
    },
    {
      id: "dLabel",
      type: "label",
      material: "cool",
      text: "d",
      // Beside the ray's near half, on the side away from the mascot.
      x: C("dMidX", -64),
      y: C("dMidY", -34),
      filled: true,
      size: 30,
      shown: { from: at("explanation", 34), to: at("closing", 20) },
    },
    {
      id: "DLabel",
      type: "label",
      material: "warm",
      text: "D",
      // At the ray's far end, where it meets the wall.
      x: C("shadeTopX", 0),
      y: C("shadeTopY", -44),
      filled: true,
      size: 30,
      shown: { from: at("explanation", 40), to: at("closing", 20) },
    },
    {
      id: "rule",
      type: "label",
      material: "ink",
      text: "{labels.1} = {labels.0} × D ÷ d",
      x: 540,
      y: { ref: "layout.headlineBottom", plus: 44 },
      parallax: 0,
      size: 32,
      filled: false,
      shown: { from: at("explanation", 20), to: at("closing", 2) },
    },
  ],
  headlines: graph.headlines,
  camera: { x: 540, y: 960, zoom: 1, maxZoom: 1.12 },
  cameraVariants: graph.cameraVariants,
  cues: graph.cues,
};

export function shadowStage(): SceneGraph {
  return SceneGraphSchema.parse(stage);
}
