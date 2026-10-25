/**
 * Evaluating a scene graph at a frame: the timeline's beats, parameters,
 * keyframed tracks and the verified solvers' outputs, all from the frame
 * number alone. The same functions serve the picture, the sound and the
 * quality checks, so they always agree.
 */
import type {
  SceneGraph,
  SceneLab,
  SceneNumber,
  SceneSolver,
  SceneTime,
  SceneTrack,
} from "@framebop/core";
import { EASE, clamp, lerp } from "../animation/timing";
import { type Rect, headlineBox } from "../cinema/layout";
import { measureTracked, wrap } from "../cinema/measure";
import { SAFE } from "../cinema/palette";
import { labPhrases } from "../lab/phrases";

export interface SceneTimeline {
  /** First frame of each beat. */
  starts: Record<string, number>;
  duration: number;
}

export function sceneTimeline(graph: SceneGraph): SceneTimeline {
  const starts: Record<string, number> = {};
  let frame = 0;
  for (const { beat, seconds } of graph.timeline) {
    starts[beat] = frame;
    frame += Math.round(seconds * graph.fps);
  }
  return { starts, duration: frame };
}

/** The values a frame is evaluated with. */
export interface SceneContext {
  graph: SceneGraph;
  values: Readonly<Record<string, number>>;
  timeline: SceneTimeline;
  /** Solver outputs by frame, computed once each. */
  cache: Map<number, Record<string, Record<string, number>>>;
  /** The words templates are filled with. */
  words: SceneWords;
}

export interface SceneWords {
  text: Record<string, string>;
  labels: readonly string[];
  phrases: Readonly<Record<string, string>>;
}

export function sceneContext(
  lab: Pick<SceneLab, "graph" | "values"> &
    Partial<Pick<SceneLab, "text" | "language">>,
): SceneContext {
  return {
    graph: lab.graph,
    values: lab.values,
    timeline: sceneTimeline(lab.graph),
    cache: new Map(),
    words: lab.text
      ? {
          text: {
            hook: lab.text.hook,
            prediction: lab.text.prediction,
            explanation: lab.text.explanation,
            closing: lab.text.closing,
          },
          labels: lab.text.contenders,
          phrases: labPhrases(lab.language ?? "en") as unknown as Record<
            string,
            string
          >,
        }
      : { text: {}, labels: [], phrases: {} },
  };
}

export function frameOf(ctx: SceneContext, time: SceneTime): number {
  if (typeof time === "number") return time;
  const start = ctx.timeline.starts[time.beat];
  if (start === undefined)
    throw new Error(`The timeline has no beat "${time.beat}".`);
  return start + time.offset;
}

export function paramValue(ctx: SceneContext, name: string): number {
  const param = ctx.graph.params[name];
  if (!param) throw new Error(`The scene has no parameter "${name}".`);
  const value = ctx.values[name] ?? param.default;
  return Math.min(param.max, Math.max(param.min, value));
}

export function numberAt(
  ctx: SceneContext,
  n: SceneNumber,
  frame: number,
): number {
  if (typeof n === "number") return n;
  const scale = (value: number) => value * (n.times ?? 1) + (n.plus ?? 0);
  if ("param" in n) return scale(paramValue(ctx, n.param));
  // Layout refs: where the headline on screen ends, so words can sit under
  // it however long the planned text turns out to be.
  if (n.ref === "layout.headlineBottom")
    return scale(headlineAt(ctx, frame)?.rect.bottom ?? SAFE.top);
  const [solver, output] = n.ref.split(".") as [string, string];
  const value = solversAt(ctx, frame)[solver]?.[output];
  if (value === undefined) throw new Error(`Nothing computes "${n.ref}".`);
  return scale(value);
}

export function trackAt(
  ctx: SceneContext,
  track: SceneTrack,
  frame: number,
): number {
  if (typeof track === "number" || !("keys" in track))
    return numberAt(ctx, track, frame);
  const keys = track.keys
    .map((key) => ({ ...key, frame: frameOf(ctx, key.at) }))
    .sort((a, b) => a.frame - b.frame);
  const first = keys[0]!;
  if (frame <= first.frame) return numberAt(ctx, first.value, frame);
  for (let i = 1; i < keys.length; i += 1) {
    const b = keys[i]!;
    if (frame <= b.frame) {
      const a = keys[i - 1]!;
      const t = EASE[b.ease](
        clamp((frame - a.frame) / Math.max(1, b.frame - a.frame)),
      );
      return lerp(
        numberAt(ctx, a.value, frame),
        numberAt(ctx, b.value, frame),
        t,
      );
    }
  }
  return numberAt(ctx, keys[keys.length - 1]!.value, frame);
}

/** Every solver's outputs at a frame. */
export function solversAt(
  ctx: SceneContext,
  frame: number,
): Record<string, Record<string, number>> {
  const known = ctx.cache.get(frame);
  if (known) return known;
  const out: Record<string, Record<string, number>> = {};
  ctx.cache.set(frame, out);
  for (const solver of ctx.graph.solvers)
    out[solver.id] = solve(ctx, solver, frame);
  if (ctx.cache.size > 2000) ctx.cache.clear();
  return out;
}

/**
 * Point-light shadow by similar triangles. A ray from the light through an
 * edge of the object meets the screen at lightY + (edgeY − lightY) · m,
 * where m = (screenX − lightX) / (objectX − lightX) is the magnification.
 * `valid` is 0 when the object is not between the light and the screen,
 * where this geometry has no shadow on the screen.
 */
export function pointShadow(input: {
  lightX: number;
  lightY: number;
  objectX: number;
  objectY: number;
  height: number;
  screenX: number;
  /** Sideways, across a screen seen face on; the same ratio applies. */
  lightU?: number;
  objectU?: number;
  width?: number;
}) {
  const { lightX, lightY, objectX, objectY, height, screenX } = input;
  const lightU = input.lightU ?? 0;
  const objectU = input.objectU ?? 0;
  const width = input.width ?? 0;
  const valid = objectX > lightX + 1 && objectX < screenX ? 1 : 0;
  const ratio = (screenX - lightX) / Math.max(1, objectX - lightX);
  const top = objectY - height / 2;
  const bottom = objectY + height / 2;
  const shadowTop = lightY + (top - lightY) * ratio;
  const shadowBottom = lightY + (bottom - lightY) * ratio;
  return {
    valid,
    ratio,
    lightX,
    lightY,
    objX: objectX,
    objTop: top,
    objBottom: bottom,
    objHeight: height,
    screenX,
    shadowTop,
    shadowBottom,
    shadowHeight: shadowBottom - shadowTop,
    /** Distances from the light, in picture pixels. */
    dObject: objectX - lightX,
    dScreen: screenX - lightX,
    midD: (lightX + objectX) / 2,
    midScreen: (lightX + screenX) / 2,
    lightU,
    objU: objectU,
    objLeft: objectU - width / 2,
    objRight: objectU + width / 2,
    shadowU: lightU + (objectU - lightU) * ratio,
    shadowLeft: lightU + (objectU - width / 2 - lightU) * ratio,
    shadowRight: lightU + (objectU + width / 2 - lightU) * ratio,
    shadowWidth: width * ratio,
    /** Midway sideways from the light to the object, and the shadow's middle. */
    midU: (lightU + objectU) / 2,
    shadowMidY: lightY + (objectY - lightY) * ratio,
    /** Midway up from the light to the object's top. */
    midTopY: (lightY + top) / 2,
  };
}

/**
 * A pinhole camera at (camU, camV, camZ) looking along depth: a point at
 * (u, v, z) lands at the camera's axis point plus its offset times
 * s = focal / (z − camZ). Straight lines stay straight, so rays drawn
 * between placed points are true. `valid` is 0 behind the camera.
 */
export function perspective(input: {
  camU: number;
  camV: number;
  camZ: number;
  focal: number;
  cx: number;
  cy: number;
  u: number;
  v: number;
  z: number;
}) {
  const depth = input.z - input.camZ;
  const valid = depth > 1 ? 1 : 0;
  const s = input.focal / Math.max(1, depth);
  return {
    valid,
    x: input.cx + (input.u - input.camU) * s,
    y: input.cy + (input.v - input.camV) * s,
    s,
  };
}

function solve(
  ctx: SceneContext,
  solver: SceneSolver,
  frame: number,
): Record<string, number> {
  switch (solver.kind) {
    case "pointShadow": {
      const shadow = pointShadow({
        lightX: numberAt(ctx, solver.light.x, frame),
        lightY: numberAt(ctx, solver.light.y, frame),
        objectX: trackAt(ctx, solver.object.x, frame),
        objectY: numberAt(ctx, solver.object.y, frame),
        height: numberAt(ctx, solver.object.height, frame),
        screenX: numberAt(ctx, solver.screen.x, frame),
        ...(solver.lateral && {
          lightU: numberAt(ctx, solver.lateral.light, frame),
          objectU: trackAt(ctx, solver.lateral.object, frame),
          width: numberAt(ctx, solver.lateral.width, frame),
        }),
      });
      return {
        ...shadow,
        screenTop: numberAt(ctx, solver.screen.top, frame),
        screenBottom: numberAt(ctx, solver.screen.bottom, frame),
      };
    }
    case "perspective": {
      // Later points may use earlier solvers' outputs, such as a shadow's.
      const camera = {
        camU: trackAt(ctx, solver.camera.u, frame),
        camV: trackAt(ctx, solver.camera.v, frame),
        camZ: trackAt(ctx, solver.camera.z, frame),
        focal: numberAt(ctx, solver.focal, frame),
        cx: numberAt(ctx, solver.center.x, frame),
        cy: numberAt(ctx, solver.center.y, frame),
      };
      const out: Record<string, number> = { valid: 1 };
      for (const [name, p] of Object.entries(solver.points)) {
        const placed = perspective({
          ...camera,
          u: trackAt(ctx, p.u, frame),
          v: trackAt(ctx, p.v, frame),
          z: trackAt(ctx, p.z, frame),
        });
        out[`${name}X`] = placed.x;
        out[`${name}Y`] = placed.y;
        out[`${name}S`] = placed.s;
        if (!placed.valid) out.valid = 0;
      }
      return out;
    }
  }
}

/**
 * Fills a template's holes: "{shadow.ratio:1}" (a solver output, to one
 * decimal), "{text.hook}", "{labels.0}", "{phrase.light}".
 */
export function fillText(
  ctx: SceneContext,
  template: string,
  frame: number,
  words: SceneWords = ctx.words,
): string {
  return template.replace(
    /\{([\w.-]+)(?::(\d))?\}/g,
    (_, path: string, digits?: string) => {
      const [head, tail] = path.split(".") as [string, string | undefined];
      if (head === "text" && tail) return words.text[tail] ?? "";
      if (head === "labels" && tail) return words.labels[Number(tail)] ?? "";
      if (head === "phrase" && tail) return words.phrases[tail] ?? "";
      const value = numberAt(ctx, { ref: path, times: 1, plus: 0 }, frame);
      return value.toFixed(digits ? Number(digits) : 0);
    },
  );
}

/** Where headlines stand: centred under the brand line. */
export const HEADLINE_Y = SAFE.top + 150;
export const HEADLINE_WIDTH = SAFE.right - SAFE.left - 40;

/**
 * How each typography style sets its headlines: a size relative to the
 * headline's own, letter spacing in ems, line spacing, and whether letters
 * spring in (kinetic) or whole lines fade or slide (clean, cinematic).
 */
export const TITLE_STYLES = {
  kinetic: { scale: 1, tracking: 0, leading: 1.02, weight: 850 },
  clean: { scale: 0.86, tracking: 0, leading: 1.06, weight: 800 },
  cinematic: { scale: 0.64, tracking: 0.16, leading: 1.34, weight: 800 },
} as const;

/**
 * A headline's size: its own, stepped down until the text wraps to at most
 * three lines, so long planned text grows no taller than the scene allows.
 */
export function headlineSize(
  text: string,
  size: number,
  style: keyof typeof TITLE_STYLES = "kinetic",
): number {
  const { weight, tracking } = TITLE_STYLES[style];
  let fitted = size;
  while (
    fitted > size * 0.62 &&
    wrap(text, fitted, HEADLINE_WIDTH, weight, tracking).length > 3
  )
    fitted = Math.round(fitted * 0.92);
  return fitted;
}

export interface HeadlineLayout {
  text: string;
  size: number;
  rect: Rect;
  lines: number;
  /** The lines as wrapped, and their spacing, for the clean styles. */
  rows: string[];
  leading: number;
}

/**
 * The latest headline to have started by a frame, as laid out: the one on
 * screen, or between two headlines the one that just left, so words placed
 * under it hold still through the gap instead of jumping.
 */
export function headlineAt(
  ctx: SceneContext,
  frame: number,
): HeadlineLayout | null {
  let latest: SceneGraph["headlines"][number] | null = null;
  let start = -Infinity;
  for (const h of ctx.graph.headlines) {
    const from = frameOf(ctx, h.from);
    if (from <= frame && from >= start) {
      latest = h;
      start = from;
    }
  }
  return latest ? headlineLayout(ctx, latest, frame) : null;
}

export function headlineLayout(
  ctx: SceneContext,
  h: SceneGraph["headlines"][number],
  frame: number,
): HeadlineLayout {
  const style = ctx.graph.typography.style;
  const { scale, tracking, leading, weight } = TITLE_STYLES[style];
  const text = fillText(ctx, h.text, frame);
  const size = headlineSize(text, Math.round(h.size * scale), style);
  const x = ctx.graph.width / 2;
  if (style === "kinetic") {
    const box = headlineBox(text, size, x, HEADLINE_Y, HEADLINE_WIDTH);
    return {
      text,
      size,
      rect: box.rect,
      lines: box.lines,
      rows: wrap(text, size, HEADLINE_WIDTH),
      leading: size * leading,
    };
  }
  const rows = wrap(text, size, HEADLINE_WIDTH, weight, tracking);
  const widest = Math.max(
    ...rows.map((row) => measureTracked(row, size, weight, tracking)),
  );
  const step = size * leading;
  return {
    text,
    size,
    rect: {
      left: x - widest / 2,
      top: HEADLINE_Y - size * 0.76,
      right: x + widest / 2,
      bottom: HEADLINE_Y + (rows.length - 1) * step + size * 0.36 + 9,
    },
    lines: rows.length,
    rows,
    leading: step,
  };
}

/** The scene camera at a frame: what it looks at, and its zoom. */
export interface SceneCamera {
  x: number;
  y: number;
  zoom: number;
}

export function cameraAt(
  ctx: SceneContext,
  frame: number,
  still: boolean,
): SceneCamera {
  const { camera, width, height } = ctx.graph;
  if (still) return { x: width / 2, y: height / 2, zoom: 1 };
  return {
    x: trackAt(ctx, camera.x, frame),
    y: trackAt(ctx, camera.y, frame),
    zoom: trackAt(ctx, camera.zoom, frame),
  };
}

/**
 * The camera as a layer of parallax `p` sees it: its moves times p, so far
 * layers (p < 1) move less and near ones more. At p = 1, the camera.
 */
export function layerCamera(
  cam: SceneCamera,
  p: number,
  width: number,
  height: number,
): SceneCamera {
  if (p === 1) return cam;
  return {
    x: width / 2 + (cam.x - width / 2) * p,
    y: height / 2 + (cam.y - height / 2) * p,
    zoom: 1 + (cam.zoom - 1) * p,
  };
}

/** A scene point in the picture, through a camera. */
export function toPicture(
  cam: SceneCamera,
  width: number,
  height: number,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: width / 2 + (x - cam.x) * cam.zoom,
    y: height / 2 + (y - cam.y) * cam.zoom,
  };
}
