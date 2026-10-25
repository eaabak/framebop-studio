/**
 * Quality checks for scene graphs: the solvers' geometry is valid where it
 * is shown, numbers on screen agree with what the solvers compute, words
 * stay clear of essential objects (the shared layout judge, on the graph's
 * own resolved shapes), and the scene really moves (no beat whose resolved
 * state stays the same for long).
 */
import type {
  AnimationSpec,
  QualityFinding,
  QualityRules,
  SceneNode,
} from "@framebop/core";
import { type Placed, type Rect, chipBox, rect } from "../cinema/layout";
import { measure } from "../cinema/measure";
import { judge } from "../lab/quality/layout";
import type { ScienceInput } from "../lab/quality/science";
import {
  type SceneCamera,
  type SceneContext,
  cameraAt,
  fillText,
  frameOf,
  headlineLayout,
  layerCamera,
  sceneContext,
  solversAt,
  toPicture,
  trackAt,
} from "./evaluate";

function contextOf(spec: AnimationSpec): SceneContext {
  const lab = spec.lab;
  if (lab?.kind !== "scene") throw new Error("Not a scene.");
  return sceneContext(lab);
}

/** Frames to look at: the middle and the end of every beat. */
function samples(ctx: SceneContext): { frame: number; beat: string }[] {
  const out: { frame: number; beat: string }[] = [];
  const beats = ctx.graph.timeline.map((t) => t.beat);
  beats.forEach((beat, i) => {
    const start = ctx.timeline.starts[beat]!;
    const end =
      i + 1 < beats.length
        ? ctx.timeline.starts[beats[i + 1]!]!
        : ctx.timeline.duration;
    out.push(
      { frame: Math.round((start + end) / 2), beat },
      { frame: Math.max(start, end - 2), beat },
    );
  });
  return out;
}

const SCENE_BEATS = new Set([
  "hook",
  "prediction",
  "experiment",
  "reveal",
  "explanation",
  "closing",
]);
const asScene = (beat: string) =>
  SCENE_BEATS.has(beat) ? (beat as QualityFinding["scene"]) : null;

export function reviewSceneScience(input: ScienceInput): QualityFinding[] {
  const ctx = contextOf(input.spec);
  const out: QualityFinding[] = [];
  const ratios: number[] = [];
  for (const { frame, beat } of samples(ctx)) {
    for (const solver of ctx.graph.solvers) {
      const s = solversAt(ctx, frame)[solver.id]!;
      if (solver.kind === "perspective" && !s.valid) {
        out.push({
          id: `science.camera:${solver.id}`,
          severity: "error",
          category: "science",
          scene: asScene(beat),
          element: "parameters",
          message: `In the ${beat}, part of the scene is behind the camera, so the picture cannot show it.`,
          suggestion: "Keep the scene in front of the camera.",
          fix: null,
        });
        continue;
      }
      if (solver.kind !== "pointShadow") continue;
      if (!s.valid) {
        out.push({
          id: `science.geometry:${solver.id}`,
          severity: "error",
          category: "science",
          scene: asScene(beat),
          element: "parameters",
          message: `In the ${beat}, the object is not between the light and the screen, so there is no shadow on the screen to show.`,
          suggestion:
            "Keep the object's positions between the light and the screen.",
          fix: null,
        });
        continue;
      }
      ratios.push(s.ratio!);
      if (s.shadowTop! < s.screenTop! || s.shadowBottom! > s.screenBottom!) {
        out.push({
          id: `science.offScreen:${solver.id}`,
          severity: "warning",
          category: "science",
          scene: asScene(beat),
          element: "parameters",
          message: `In the ${beat} the shadow is ${Math.round(s.shadowHeight!)} px tall and runs off the screen.`,
          suggestion:
            "Make the object smaller, or keep it further from the light.",
          fix: null,
        });
      }
    }
  }
  // Size claims ("5× BIGGER") must agree with the computed magnification.
  if (ratios.length > 0) {
    const low = Math.min(...ratios);
    const high = Math.max(...ratios);
    for (const field of [
      "hook",
      "prediction",
      "explanation",
      "closing",
    ] as const) {
      for (const claim of input.numbers[field]) {
        const times = /×|X$|^X/i.test(claim.token);
        if (times || claim.unit === "count") {
          if (claim.value >= low - 0.05 && claim.value <= high + 0.05) continue;
          if (claim.unit === "count" && !times) continue;
          out.push({
            id: `numbers.ratio.${claim.token}:text.${field}`,
            severity: "error",
            category: "numbers",
            scene: asScene(field),
            element: `text.${field}`,
            message: `The ${field} says ${claim.token}, but the shadow is ${low.toFixed(1)}× to ${high.toFixed(1)}× the object in this scene.`,
            suggestion:
              "Use the size shown on screen, which the scene computes.",
            fix: null,
          });
        } else {
          out.push({
            id: `numbers.other.${claim.token}:text.${field}`,
            severity: "warning",
            category: "numbers",
            scene: asScene(field),
            element: `text.${field}`,
            message: `"${claim.token}" in the ${field} is not something this scene computes.`,
            suggestion: "Remove it, or use the size the scene shows.",
            fix: null,
          });
        }
      }
    }
  }
  return [...new Map(out.map((f) => [f.id, f])).values()];
}

/** The box a primitive covers at a frame, for the layout judge. */
function boxOf(node: SceneNode, ctx: SceneContext, f: number): Rect | null {
  const v = (t: Parameters<typeof trackAt>[1]) => trackAt(ctx, t, f);
  switch (node.type) {
    case "circle":
    case "glow": {
      const r = v(node.r);
      return rect(
        v(node.cx) - r,
        v(node.cy) - r,
        v(node.cx) + r,
        v(node.cy) + r,
      );
    }
    case "rect": {
      const x = v(node.x);
      const y = v(node.y);
      return rect(
        Math.min(x, x + v(node.w)),
        Math.min(y, y + v(node.h)),
        Math.max(x, x + v(node.w)),
        Math.max(y, y + v(node.h)),
      );
    }
    case "polygon":
    case "path": {
      const xs = node.points.map((p) => v(p.x));
      const ys = node.points.map((p) => v(p.y));
      return rect(
        Math.min(...xs),
        Math.min(...ys),
        Math.max(...xs),
        Math.max(...ys),
      );
    }
    case "line":
    case "arrow":
      return rect(
        Math.min(v(node.x1), v(node.x2)),
        Math.min(v(node.y1), v(node.y2)),
        Math.max(v(node.x1), v(node.x2)),
        Math.max(v(node.y1), v(node.y2)),
      );
    case "mascot":
    case "prop":
      return figureBox(
        node,
        v(node.x),
        v(node.y),
        v(node.size) * v(node.scale),
      );
    case "silhouette": {
      const of = ctx.graph.nodes.find((n) => n.id === node.of);
      if (!of || (of.type !== "mascot" && of.type !== "prop")) return null;
      const box = figureBox(
        of,
        v(node.x),
        v(node.y),
        v(node.size) * v(node.scale),
      );
      const clip = node.clipBottom ? v(node.clipBottom) : Infinity;
      return rect(box.left, box.top, box.right, Math.min(box.bottom, clip));
    }
    default:
      return null;
  }
}

/** Width of a figure for its height, as the renderer draws it. */
const FIGURE_WIDTH = { mascot: 0.9, candle: 0.26, lantern: 0.62, crate: 1.1 };

function figureBox(
  node: Extract<SceneNode, { type: "mascot" | "prop" }>,
  x: number,
  y: number,
  size: number,
): Rect {
  const w = size * FIGURE_WIDTH[node.type === "mascot" ? "mascot" : node.kind];
  return rect(x - w / 2, y - size, x + w / 2, y);
}

/** A box in the scene as the camera shows it, for the node's layer. */
function onScreen(
  box: Rect,
  node: SceneNode,
  cam: SceneCamera,
  width: number,
  height: number,
): Rect {
  const c = layerCamera(cam, node.parallax, width, height);
  const a = toPicture(c, width, height, box.left, box.top);
  const b = toPicture(c, width, height, box.right, box.bottom);
  return rect(a.x, a.y, b.x, b.y);
}

export function reviewSceneLayout(
  spec: AnimationSpec,
  rules: QualityRules,
): QualityFinding[] {
  const ctx = contextOf(spec);
  const lab = spec.lab!;
  if (lab.kind !== "scene") return [];
  const visible = (node: SceneNode, f: number) => {
    if (!node.shown) return true;
    return (
      f >= frameOf(ctx, node.shown.from) && f <= frameOf(ctx, node.shown.to)
    );
  };
  const moments = samples(ctx).map(({ frame: f, beat }) => {
    const cam = cameraAt(ctx, f, lab.camera === "still");
    const screen = (box: Rect, node: SceneNode) =>
      onScreen(box, node, cam, spec.width, spec.height);
    const texts: Placed[] = [];
    const essential: Placed[] = [];
    const minor: Placed[] = [];
    for (const h of ctx.graph.headlines) {
      if (f < frameOf(ctx, h.from) || f > frameOf(ctx, h.to)) continue;
      const box = headlineLayout(ctx, h, f);
      texts.push({
        name: `the headline "${box.text}"`,
        kind: "text",
        rect: box.rect,
        size: box.size,
        lines: box.lines,
      });
    }
    for (const node of ctx.graph.nodes) {
      if (!visible(node, f)) continue;
      if (node.type === "label" || node.type === "text") {
        const text = fillText(ctx, node.text, f);
        const x = trackAt(ctx, node.x, f);
        const y = trackAt(ctx, node.y, f);
        const r =
          node.type === "label"
            ? chipBox(text, node.size, x, y, node.filled)
            : (() => {
                const w = measure(text, node.size, node.weight);
                const left =
                  node.align === "middle"
                    ? x - w / 2
                    : node.align === "end"
                      ? x - w
                      : x;
                return rect(
                  left,
                  y - node.size * 0.76,
                  left + w,
                  y + node.size * 0.24,
                );
              })();
        texts.push({
          name: `the label "${text}"`,
          kind: "text",
          rect: screen(r, node),
          size: node.size * cam.zoom,
        });
        continue;
      }
      const box = boxOf(node, ctx, f);
      if (!box || node.id === "backdrop") continue;
      (node.essential ? essential : minor).push({
        name: `the ${node.id}`,
        kind: "object",
        rect: screen(box, node),
      });
    }
    // Words over decorative layers (the light, the backdrop) are fine.
    void minor;
    return {
      name: `in the ${beat}`,
      scene: asScene(beat),
      texts,
      essential,
      minor: [] as Placed[],
    };
  });
  const findings = judge(moments, spec, rules);
  // The scene must move: a long stretch where nothing changes enough to see
  // plays as a still picture (Scene Doctor reports it as frozen). Each frame
  // is compared with the first of its run, with thresholds calibrated on
  // the Doctor's freeze detection in real renders: words, shapes and light
  // that change count, a slow camera drift of a few pixels does not.
  const fps = ctx.graph.fps;
  const stateAt = (f: number) => ({
    solvers: Object.values(solversAt(ctx, f)).flatMap((s) => Object.values(s)),
    // A trail shows only what moved, so its own showing is not motion.
    opacity: ctx.graph.nodes
      .filter((n) => n.type !== "trail")
      .map((n) => (visible(n, f) ? trackAt(ctx, n.opacity, f) : -1)),
    zoom: trackAt(ctx, ctx.graph.camera.zoom, f),
    x: trackAt(ctx, ctx.graph.camera.x, f),
    y: trackAt(ctx, ctx.graph.camera.y, f),
    // A headline moves while its letters stagger in (about 26 frames, as
    // KineticTitle draws them) and while it leaves (its last 10).
    headlines: ctx.graph.headlines.map((h) => {
      const from = frameOf(ctx, h.from);
      const to = frameOf(ctx, h.to);
      if (f < from || f > to) return -1;
      return f > to - 10 ? 100 + f - to : Math.min(26, f - from);
    }),
  });
  const seen = (a: ReturnType<typeof stateAt>, b: typeof a) =>
    a.solvers.some((v, i) => Math.abs(v - b.solvers[i]!) > 0.5) ||
    a.opacity.some((v, i) => Math.abs(v - b.opacity[i]!) > 0.02) ||
    Math.abs(a.zoom - b.zoom) > 0.02 ||
    Math.abs(a.x - b.x) > 6 ||
    Math.abs(a.y - b.y) > 6 ||
    a.headlines.some((v, i) => v !== b.headlines[i]);
  let longest = { frames: 0, at: 0 };
  let anchor = { frame: 0, state: stateAt(0) };
  for (let f = 2; f < ctx.timeline.duration; f += 2) {
    const state = stateAt(f);
    if (seen(state, anchor.state)) anchor = { frame: f, state };
    else if (f - anchor.frame > longest.frames)
      longest = { frames: f - anchor.frame, at: anchor.frame };
  }
  if (longest.frames >= 2 * fps) {
    const beat =
      [...ctx.graph.timeline]
        .reverse()
        .find((t) => (ctx.timeline.starts[t.beat] ?? 0) <= longest.at)?.beat ??
      "";
    findings.push({
      id: `timing.still:${beat}`,
      severity: "warning",
      category: "readability",
      scene: asScene(beat),
      element: `scenes.${beat}`,
      message: `Nothing in the scene changes for ${(longest.frames / fps).toFixed(1)} s in the ${beat}.`,
      suggestion: `Shorten the ${beat}, or give it motion in its keyframes.`,
      fix: null,
    });
  }
  return findings;
}
