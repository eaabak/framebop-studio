/**
 * The capability registry: every kind of animation the AI Director may
 * plan, with its parameters and their limits, the assumptions it shows,
 * its scientific checks, and the adapter that builds an animation from a
 * blueprint. A blueprint is data; nothing in it is ever run as code, and
 * results (who wins, by how much) always come from the simulation.
 */
import {
  type AnimationBlueprint,
  AnimationBlueprintSchema,
  type AnimationCapability,
  type AnimationSpec,
  AnimationSpecSchema,
  type BlueprintBeat,
  type CapabilityInfo,
  type CapabilityParameter,
  type DirectorNotice,
  type LabText,
  type QualityFinding,
  type QualityReport,
  type QualityRules,
  QualityRulesSchema,
  type SceneGraph,
  SceneGraphSchema,
  resolveDirection,
} from "@framebop/core";
import { SUBJECT_SCALE, composeScene } from "../scene/compose";
import { sceneTimeline } from "../scene/evaluate";
import { shadowScene, shadowStage } from "../scene/library/shadow";
import { reviewSceneLayout, reviewSceneScience } from "../scene/quality";
import { brachistochroneRun } from "./experiments";
import { maxShaft } from "./muller/geometry";
import { PHRASE_LANGUAGES, labPhrases } from "./phrases";
import { reviewContrast } from "./quality/contrast";
import { reviewIllusionLayout, reviewRaceLayout } from "./quality/layout";
import {
  type ScienceInput,
  TEXT_FIELDS,
  type TextField,
  reviewIllusion,
  reviewRace,
} from "./quality/science";
import { type NumberClaim, reviewLine } from "./quality/text";

const FPS = 30;

/** Longest headline, in characters, a planner is asked to keep under. */
export const SCREEN_TEXT_MAX = 36;

interface BeatRule {
  beat: BlueprintBeat;
  min: number;
  max: number;
  default: number;
  /** Decided by the simulation; a planned length is replaced. */
  fixed?: boolean;
}

export interface Capability {
  id: AnimationCapability;
  name: string;
  /** What it shows, for the planner and the interface. */
  summary: string;
  /** When an idea fits it, for the planner. */
  fits: string;
  /** What the labels must name, in order. */
  labels: [string, string];
  parameters: CapabilityParameter[];
  beats: BeatRule[];
  assumptions: string[];
  /** Ways it can be composed, which art direction chooses between. */
  compositions?: CapabilityInfo["compositions"];
  /**
   * Scientific review against the experiment's own facts. A wrong claim
   * that has a verified replacement is replaced in `text` and reported.
   */
  science(input: ScienceInput): QualityFinding[];
  /** Layout preflight on the built animation, at representative frames. */
  layout(spec: AnimationSpec, rules: QualityRules): QualityFinding[];
  defaults(): Omit<AnimationBlueprint, "idea" | "language">;
  compile(blueprint: AnimationBlueprint): {
    spec: AnimationSpec;
    blueprint: AnimationBlueprint;
    notices: DirectorNotice[];
  };
}

const parameter = (
  key: string,
  label: string,
  description: string,
  min: number,
  max: number,
  step: number,
  fallback: number,
  unit = "",
): CapabilityParameter => ({
  key,
  label,
  description,
  min,
  max,
  step,
  default: fallback,
  unit,
});

/** Seconds of each beat the capability uses, in its order, within limits. */
function sceneSeconds(
  blueprint: AnimationBlueprint,
  rules: readonly BeatRule[],
  notices: DirectorNotice[],
): Map<BlueprintBeat, number> {
  const planned = new Map(blueprint.scenes.map((s) => [s.beat, s.seconds]));
  const out = new Map<BlueprintBeat, number>();
  for (const rule of rules) {
    const value = planned.get(rule.beat);
    if (value === undefined) {
      out.set(rule.beat, rule.default);
      continue;
    }
    const clamped = Math.min(rule.max, Math.max(rule.min, value));
    if (!rule.fixed && Math.abs(clamped - value) > 0.05) {
      notices.push({
        severity: "info",
        message: `The ${rule.beat} lasts ${clamped.toFixed(1)} s instead of ${value.toFixed(1)} s, within what this animation allows.`,
      });
    }
    out.set(rule.beat, clamped);
  }
  return out;
}

/** Every planned number, clamped to its parameter's range and step. */
function numbers(
  blueprint: AnimationBlueprint,
  parameters: readonly CapabilityParameter[],
  notices: DirectorNotice[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of parameters) {
    const raw = blueprint.parameters[p.key];
    let value =
      typeof raw === "number" && Number.isFinite(raw) ? raw : p.default;
    value = Math.round(value / p.step) * p.step;
    const clamped = Math.min(p.max, Math.max(p.min, value));
    if (raw !== undefined && Math.abs(clamped - raw) > p.step / 2) {
      notices.push({
        severity: "info",
        message: `${p.label} is ${clamped} instead of ${raw}, within its range (${p.min}–${p.max}).`,
      });
    }
    out[p.key] = Number(clamped.toFixed(4));
  }
  return out;
}

/** The plan's words in capitals for the video's language. */
function labText(text: AnimationBlueprint["text"]): LabText {
  return {
    hook: text.hook,
    prediction: text.prediction,
    explanation: text.explanation,
    closing: text.closing,
    contenders: text.labels,
  };
}

const brachistochrone: Capability = {
  id: "brachistochrone",
  name: "Which path wins? (brachistochrone race)",
  summary:
    "Two identical objects slide without friction from the same start to the same lower finish: one down a straight ramp, one down a curved (cycloid) track. The curve always wins; the simulation decides by how much.",
  fits: "races between paths, fastest descent, shortest is not quickest, gravity and slopes, the brachistochrone or cycloid.",
  labels: ["the straight path", "the curved path"],
  parameters: [
    parameter(
      "span",
      "Span",
      "Horizontal distance from start to finish",
      1.2,
      3,
      0.1,
      2,
      "m",
    ),
    parameter(
      "drop",
      "Drop",
      "How far the finish is below the start",
      0.6,
      1.6,
      0.05,
      1.1,
      "m",
    ),
    parameter(
      "slowMotion",
      "Slow motion",
      "Seconds of video per simulated second",
      3,
      8,
      0.5,
      5,
      "×",
    ),
  ],
  beats: [
    { beat: "hook", min: 0.8, max: 2, default: 1.2 },
    { beat: "experiment", min: 0, max: 30, default: 5, fixed: true },
    { beat: "reveal", min: 1.4, max: 3, default: 1.8 },
    { beat: "explanation", min: 5, max: 10, default: 7 },
    { beat: "closing", min: 2, max: 4, default: 3 },
  ],
  assumptions: [
    "Ideal point masses sliding without friction",
    "Uniform gravity; both released from rest at once",
    "Same start and the same finish for both",
  ],
  science: reviewRace,
  layout(spec, rules) {
    return reviewRaceLayout(
      spec,
      rules,
      labPhrases(spec.lab?.language ?? "en"),
    );
  },
  defaults() {
    return {
      version: 1,
      capability: "brachistochrone",
      concept: {
        title: "Which path wins?",
        objective: "Show that the fastest way down is not the shortest one.",
        audience: "Curious viewers, no physics needed",
        hook: "Two identical balls, two paths, one finish.",
      },
      text: {
        hook: "WHICH PATH WINS?",
        prediction: "STRAIGHT OR CURVED?",
        explanation: "STEEP DROP. EARLY SPEED.",
        closing: "LONGER CAN BE FASTER.",
        labels: ["STRAIGHT", "CURVED"],
      },
      scenes: [
        {
          beat: "hook",
          seconds: 1.2,
          note: "Both tracks; the race starts at once.",
        },
        {
          beat: "experiment",
          seconds: 5,
          note: "The race, from the simulation.",
        },
        { beat: "reveal", seconds: 1.8, note: "The curve wins; by how much." },
        {
          beat: "explanation",
          seconds: 7,
          note: "Replay with marks at the same moments.",
        },
        { beat: "closing", seconds: 3, note: "Back to both whole tracks." },
      ],
      style: { primary: "#FF7A1F", secondary: "#14D9CF" },
      camera: "gentle",
      audio: { mood: "bright" },
      direction: { style: "educational" },
      parameters: { span: 2, drop: 1.1, slowMotion: 5 },
      assumptions: this.assumptions,
    };
  },
  compile(input) {
    const notices: DirectorNotice[] = [];
    const p = numbers(input, this.parameters, notices);
    // A track much flatter or steeper than this leaves the race unreadable.
    let drop = p.drop!;
    const ratio = p.span! / drop;
    if (ratio < 0.9 || ratio > 3) {
      drop = Number((p.span! / Math.min(3, Math.max(0.9, ratio))).toFixed(3));
      notices.push({
        severity: "info",
        message: `The drop is ${drop} m so the tracks keep a readable shape.`,
      });
    }
    const seconds = sceneSeconds(input, this.beats, notices);
    const slow = p.slowMotion!;
    const run = brachistochroneRun({ span: p.span!, drop, gravity: 9.81 });
    const last = Math.max(run.straight.arrival, run.curve.arrival);
    const release = Math.round(seconds.get("hook")! * FPS);
    const reveal = Math.ceil(release + last * slow * FPS) + 3;
    const explanation = reveal + Math.round(seconds.get("reveal")! * FPS);
    const replay = Math.ceil((last + 0.02) * slow * FPS);
    const explanationFrames = Math.max(
      Math.round(seconds.get("explanation")! * FPS),
      18 + replay + 36,
    );
    const closing = explanation + explanationFrames;
    const duration = closing + Math.round(seconds.get("closing")! * FPS);
    // Words and colours arrive reviewed by the quality pipeline.
    const text = input.text;
    const style = input.style;
    const blueprint = settle({ ...input, style }, this, p, text, [
      ["hook", release],
      ["experiment", reveal - release],
      ["reveal", explanation - reveal],
      ["explanation", explanationFrames],
      ["closing", duration - closing],
    ]);
    blueprint.parameters.drop = drop;
    const spec = AnimationSpecSchema.parse({
      version: 1,
      width: 1080,
      height: 1920,
      renderer: "lab",
      fps: FPS,
      durationFrames: duration,
      sky: { top: "#0B0D12", bottom: "#0B0D12" },
      camera: { x: 0, y: 0, zoom: 1 },
      assets: {},
      layers: [],
      characters: [],
      lab: {
        kind: "brachistochrone",
        span: p.span,
        drop,
        gravity: 9.81,
        slowMotion: slow,
        replaySlowMotion: slow,
        releaseFrame: release,
        beats: {
          prediction: 4,
          experiment: Math.max(5, release - 6),
          reveal,
          explanation,
          closing,
        },
        text: labText(text),
        style,
        camera: input.camera,
        language: input.language,
      },
      director: blueprint,
    });
    return { spec, blueprint, notices };
  },
};

const mullerLyer: Capability = {
  id: "muller-lyer",
  name: "Equal lines, different lengths (Müller-Lyer illusion)",
  summary:
    "Two line segments of exactly the same length: one with fins pointing outwards looks longer, one with fins pointing inwards looks shorter. Guides and rulers measure them, the fins are taken away, and the lines are laid on each other.",
  fits: "optical illusions about length or size, equal lines that look different, perception, how context changes what we see, the Müller-Lyer illusion.",
  labels: ["the figure that looks longer", "the figure that looks shorter"],
  parameters: [
    parameter(
      "shaft",
      "Line length",
      "Both lines' length, as a share of the picture's width",
      0.35,
      0.7,
      0.01,
      0.6,
    ),
    parameter(
      "fin",
      "Fin length",
      "Each fin's length, as a share of the line",
      0.1,
      0.35,
      0.01,
      0.2,
    ),
    parameter(
      "finAngle",
      "Fin angle",
      "Angle between each fin and its line",
      15,
      60,
      1,
      35,
      "°",
    ),
    parameter(
      "gap",
      "Gap",
      "Distance between the two figures, as a share of the height",
      0.12,
      0.3,
      0.01,
      0.2,
    ),
    parameter(
      "longerOnTop",
      "Longer-looking on top",
      "1 puts the outward-finned figure on top, 0 below",
      0,
      1,
      1,
      1,
    ),
  ],
  beats: [
    { beat: "hook", min: 1.2, max: 2.5, default: 1.8 },
    { beat: "prediction", min: 1.5, max: 3, default: 2.2 },
    { beat: "experiment", min: 2, max: 4, default: 2.6 },
    { beat: "reveal", min: 2, max: 4, default: 2.6 },
    { beat: "explanation", min: 2.6, max: 6, default: 4 },
    { beat: "closing", min: 2, max: 4, default: 2.6 },
  ],
  assumptions: [
    "Both lines are exactly the same length",
    "Only the fins differ",
  ],
  science: reviewIllusion,
  layout(spec, rules) {
    return reviewIllusionLayout(
      spec,
      rules,
      labPhrases(spec.lab?.language ?? "en"),
    );
  },
  defaults() {
    return {
      version: 1,
      capability: "muller-lyer",
      concept: {
        title: "Which line is longer?",
        objective:
          "Show that two equal lines look different because of the fins at their ends.",
        audience: "Curious viewers of any age",
        hook: "Two lines, one clearly longer. Or is it?",
      },
      text: {
        hook: "WHICH LINE IS LONGER?",
        prediction: "TOP OR BOTTOM?",
        explanation: "YOUR EYE MEASURES THE WHOLE SHAPE.",
        closing: "SAME LINES. DIFFERENT CONTEXT.",
        labels: ["A", "B"],
      },
      scenes: [
        { beat: "hook", seconds: 1.8, note: "Both figures; the question." },
        { beat: "prediction", seconds: 2.2, note: "Each figure lit in turn." },
        {
          beat: "experiment",
          seconds: 2.6,
          note: "Guides from the ends, rulers under both.",
        },
        {
          beat: "reveal",
          seconds: 2.6,
          note: "Fins away; the lines laid on each other.",
        },
        {
          beat: "explanation",
          seconds: 4,
          note: "The whole shapes, fins included, boxed.",
        },
        { beat: "closing", seconds: 2.6, note: "Back to the opening picture." },
      ],
      style: { primary: "#FF7A1F", secondary: "#14D9CF" },
      camera: "gentle",
      audio: { mood: "bright" },
      direction: { style: "educational" },
      parameters: {
        shaft: 0.6,
        fin: 0.2,
        finAngle: 35,
        gap: 0.2,
        longerOnTop: 1,
      },
      assumptions: this.assumptions,
    };
  },
  compile(input) {
    const notices: DirectorNotice[] = [];
    const p = numbers(input, this.parameters, notices);
    // Both figures, fins and all, must fit across the picture.
    const most = maxShaft(p.fin!, p.finAngle!);
    if (p.shaft! > most) {
      p.shaft = Math.floor(most * 100) / 100;
      notices.push({
        severity: "info",
        message: `The lines are ${p.shaft} of the width so the fins stay in the picture.`,
      });
    }
    const seconds = sceneSeconds(input, this.beats, notices);
    const frames = this.beats.map((rule) =>
      Math.round(seconds.get(rule.beat)! * FPS),
    );
    const starts = frames.map((_, i) =>
      frames.slice(0, i).reduce((a, b) => a + b, 0),
    );
    const duration = frames.reduce((a, b) => a + b, 0);
    // Words and colours arrive reviewed by the quality pipeline.
    const text = input.text;
    const style = input.style;
    const blueprint = settle(
      { ...input, style },
      this,
      p,
      text,
      this.beats.map(
        (rule, i) => [rule.beat, frames[i]!] as [BlueprintBeat, number],
      ),
    );
    const spec = AnimationSpecSchema.parse({
      version: 1,
      width: 1080,
      height: 1920,
      renderer: "lab",
      fps: FPS,
      durationFrames: duration,
      sky: { top: "#0B0D12", bottom: "#0B0D12" },
      camera: { x: 0, y: 0, zoom: 1 },
      assets: {},
      layers: [],
      characters: [],
      lab: {
        kind: "muller-lyer",
        shaft: p.shaft,
        fin: p.fin,
        finAngle: p.finAngle,
        gap: p.gap,
        longerOnTop: p.longerOnTop! >= 0.5,
        beats: {
          prediction: starts[1]!,
          experiment: starts[2]!,
          reveal: starts[3]!,
          explanation: starts[4]!,
          closing: starts[5]!,
        },
        text: labText(text),
        style,
        camera: input.camera,
        language: input.language,
      },
      director: blueprint,
    });
    return { spec, blueprint, notices };
  },
};

/** The blueprint as built: real numbers, real lengths, the fixed facts. */
function settle(
  input: AnimationBlueprint,
  capability: Capability,
  parameters: Record<string, number>,
  text: AnimationBlueprint["text"],
  beats: [BlueprintBeat, number][],
): AnimationBlueprint {
  const notes = new Map(input.scenes.map((s) => [s.beat, s.note]));
  const fallback = new Map(
    capability.defaults().scenes.map((s) => [s.beat, s.note]),
  );
  return AnimationBlueprintSchema.parse({
    ...input,
    text,
    parameters,
    assumptions: capability.assumptions,
    scenes: beats.map(([beat, frames]) => ({
      beat,
      seconds: Number((frames / FPS).toFixed(2)),
      note: notes.get(beat) || fallback.get(beat) || "",
    })),
  });
}

/**
 * Each label names its own role: a label that names the other role ("LIGHT"
 * on the object, "OBJECT" on the shadow) or another word the scene shows
 * would label the picture wrongly, so it blocks the build.
 */
function labelRoles(
  input: ScienceInput,
  doc: SceneGraph,
  defaults: readonly [string, string],
): QualityFinding[] {
  const language = input.blueprint.language;
  const up = (s: string) => s.trim().toLocaleUpperCase(language);
  const phrases = input.words as unknown as Record<string, string>;
  const shown = new Set(
    JSON.stringify(doc.nodes)
      .match(/\{phrase\.(\w+)\}/g)
      ?.map((m) => up(phrases[m.slice(8, -1)] ?? "")) ?? [],
  );
  const labels = input.text.labels;
  const out: QualityFinding[] = [];
  labels.forEach((label, i) => {
    const other = up(defaults[1 - i] ?? "");
    const clash =
      up(label) === other
        ? `names the other role ("${other}")`
        : shown.has(up(label))
          ? `repeats "${up(label)}", which the scene already shows`
          : i === 1 && up(label) === up(labels[0])
            ? "is the same as the first label"
            : null;
    if (!clash) return;
    out.push({
      id: `labels.role.${i}:text.labels.${i}`,
      severity: "error",
      category: "science",
      scene: null,
      element: `text.labels.${i}`,
      message: `The ${i === 0 ? "first" : "second"} label, "${up(label)}", ${clash}, so it would name the wrong thing in the picture.`,
      suggestion: `Use a word for ${i === 0 ? "the moving object" : "its shadow"}, like "${defaults[i]}".`,
      fix: language.toLowerCase().startsWith("en")
        ? { field: `text.labels.${i}`, value: defaults[i]!, applied: false }
        : null,
    });
  });
  return out;
}

/**
 * A capability made from scene graph documents, one per composition (the
 * same science shown as a diagram, or staged as a scene): its parameters,
 * beats and defaults come from the documents, the build sets the values
 * and timeline, the composer applies the art direction, and the checks are
 * the scene graph's own. Adding a scene is adding documents and a line
 * below; there is no component to write.
 */
function sceneCapability(meta: {
  id: AnimationCapability;
  name: string;
  summary: string;
  fits: string;
  labels: [string, string];
  assumptions: string[];
  /** The first is the capability's own; the rest share its parameters. */
  compositions: {
    id: string;
    name: string;
    summary: string;
    graph: () => SceneGraph;
  }[];
  defaults: Omit<
    AnimationBlueprint,
    | "idea"
    | "language"
    | "scenes"
    | "parameters"
    | "assumptions"
    | "capability"
    | "version"
  >;
}): Capability {
  const docs = meta.compositions.map((c) => ({ ...c, doc: c.graph() }));
  const doc = docs[0]!.doc;
  // Compositions show one science: a parameter they share means the same
  // in each, and they tell the story in the same beats.
  const params = new Map<string, SceneGraph["params"][string]>();
  for (const c of docs) {
    for (const [key, p] of Object.entries(c.doc.params)) {
      const known = params.get(key);
      if (known && JSON.stringify(known) !== JSON.stringify(p))
        throw new Error(`"${c.id}" defines "${key}" differently.`);
      params.set(key, p);
    }
    if (
      c.doc.timeline.map((t) => t.beat).join() !==
      doc.timeline.map((t) => t.beat).join()
    )
      throw new Error(`"${c.id}" tells the story in other beats.`);
  }
  const parameters = [...params].map(([key, p]) =>
    parameter(
      key,
      p.label,
      p.description,
      p.min,
      p.max,
      p.step,
      p.default,
      p.unit,
    ),
  );
  const beats: BeatRule[] = doc.timeline.map((t) => ({
    beat: t.beat as BlueprintBeat,
    min: Math.max(0.8, t.seconds / 2),
    // The tightest limit any composition sets: past it, one would hold still.
    max: Math.min(
      12,
      ...docs.map((c) => {
        const own = c.doc.timeline.find((x) => x.beat === t.beat)!;
        return own.max ?? own.seconds * 2;
      }),
    ),
    default: t.seconds,
  }));
  const compositions = docs.map((c) => ({
    id: c.id,
    name: c.name,
    summary: c.summary,
    parameters: Object.keys(c.doc.params),
  }));
  return {
    id: meta.id,
    name: meta.name,
    summary: meta.summary,
    fits: meta.fits,
    labels: meta.labels,
    parameters,
    beats,
    assumptions: meta.assumptions,
    compositions,
    science: (input) => {
      const lab = input.spec.lab;
      const graph = lab?.kind === "scene" ? lab.graph : doc;
      return [
        ...reviewSceneScience(input),
        ...labelRoles(input, graph, meta.defaults.text.labels),
      ];
    },
    layout: reviewSceneLayout,
    defaults() {
      return {
        version: 1,
        capability: meta.id,
        ...meta.defaults,
        scenes: doc.timeline.map((t) => ({
          beat: t.beat as BlueprintBeat,
          seconds: t.seconds,
          note: "",
        })),
        parameters: Object.fromEntries(
          parameters.map((p) => [p.key, p.default]),
        ),
        assumptions: meta.assumptions,
      };
    },
    compile(input) {
      const notices: DirectorNotice[] = [];
      const { direction, problems } = resolveDirection(
        input.direction,
        docs.map((c) => c.id),
      );
      for (const message of problems)
        notices.push({ severity: "warning", message });
      const chosen = docs.find((c) => c.id === direction.composition)!.doc;
      const values = numbers(input, parameters, notices);
      // Subject prominence sizes the subject through its own parameter, so
      // the science (a larger object, a larger shadow) stays computed.
      const subject = chosen.subject?.param;
      const rule = parameters.find((p) => p.key === subject);
      if (rule && SUBJECT_SCALE[direction.subject] !== 1) {
        const scaled = Math.min(
          rule.max,
          Math.max(
            rule.min,
            Math.round(
              (values[rule.key]! * SUBJECT_SCALE[direction.subject]) /
                rule.step,
            ) * rule.step,
          ),
        );
        if (scaled !== values[rule.key])
          notices.push({
            severity: "info",
            message: `${rule.label} is ${scaled} instead of ${values[rule.key]}, for a ${direction.subject} subject.`,
          });
        values[rule.key] = scaled;
      }
      const seconds = sceneSeconds(input, beats, notices);
      const graph = composeScene(
        SceneGraphSchema.parse({
          ...chosen,
          timeline: chosen.timeline.map((t) => ({
            beat: t.beat,
            seconds: seconds.get(t.beat as BlueprintBeat) ?? t.seconds,
          })),
        }),
        direction,
      );
      const { starts, duration } = sceneTimeline(graph);
      const start = (beat: string, fallback: number) =>
        starts[beat] ?? fallback;
      const experiment = start("experiment", 30);
      const reveal = start("reveal", experiment + 30);
      const explanation = start("explanation", reveal + 30);
      const closing = start("closing", explanation + 30);
      const blueprint = settle(
        input,
        this,
        numbers(input, parameters, []),
        input.text,
        graph.timeline.map(
          (t) =>
            [t.beat as BlueprintBeat, Math.round(t.seconds * graph.fps)] as [
              BlueprintBeat,
              number,
            ],
        ),
      );
      const spec = AnimationSpecSchema.parse({
        version: 1,
        width: graph.width,
        height: graph.height,
        renderer: "lab",
        fps: graph.fps,
        durationFrames: duration,
        sky: { top: "#0B0D12", bottom: "#0B0D12" },
        camera: { x: 0, y: 0, zoom: 1 },
        assets: {},
        layers: [],
        characters: [],
        lab: {
          kind: "scene",
          graph,
          values,
          beats: {
            prediction: Math.min(start("prediction", 4), experiment - 1),
            experiment,
            reveal,
            explanation,
            closing,
          },
          text: labText(input.text),
          style: input.style,
          camera: input.camera,
          language: input.language,
        },
        director: blueprint,
      });
      return { spec, blueprint, notices };
    },
  };
}

const pointLightShadow = sceneCapability({
  id: "point-light-shadow",
  name: "Why a shadow grows (point light)",
  summary:
    "A point light, an object that moves towards it and back, and a screen. The shadow's size is computed by similar triangles (size × D ÷ d) and shown as it changes, with the rays that make its edges.",
  fits: "shadows, light and shadow size, why a shadow grows or shrinks, point light geometry, similar triangles, projection.",
  labels: ["the moving object", "its shadow"],
  assumptions: [
    "A point light: all rays start from one point",
    "A flat screen or wall, square to the line from the light",
  ],
  compositions: [
    {
      id: "diagram",
      name: "Diagram",
      summary:
        "A clean side view: light, object and screen in a line, the rays, the measured size and the distances d and D.",
      graph: shadowScene,
    },
    {
      id: "stage",
      name: "Stage",
      summary:
        "A dark room seen from the front: the Framebop mascot walks towards a lantern on the floor and its shadow towers on the wall behind it, then the rays that make it are shown.",
      graph: shadowStage,
    },
  ],
  defaults: {
    concept: {
      title: "Why does a shadow grow?",
      objective:
        "Show that a shadow grows as an object nears a point light, because the rays spread out from the light.",
      audience: "Curious viewers, no physics needed",
      hook: "An object moves towards a light. Its shadow keeps growing.",
    },
    text: {
      hook: "WHY DOES A SHADOW GROW?",
      prediction: "WATCH IT NEAR THE LIGHT",
      explanation: "THE RAYS SPREAD OUT",
      closing: "CLOSER TO THE LIGHT, BIGGER SHADOW.",
      labels: ["OBJECT", "SHADOW"],
    },
    style: { primary: "#FF7A1F", secondary: "#14D9CF" },
    camera: "gentle",
    audio: { mood: "bright" },
    direction: { style: "educational" },
  },
});

export const CAPABILITIES: Record<AnimationCapability, Capability> = {
  brachistochrone,
  "muller-lyer": mullerLyer,
  "point-light-shadow": pointLightShadow,
};

export function capabilityInfo(): CapabilityInfo[] {
  return Object.values(CAPABILITIES).map((c) => ({
    id: c.id,
    name: c.name,
    summary: c.summary,
    parameters: c.parameters,
    beats: c.beats.map(({ beat, min, max, fixed }) => ({
      beat,
      min,
      max,
      fixed: fixed ?? false,
    })),
    assumptions: c.assumptions,
    compositions: c.compositions ?? [],
  }));
}

/** A capability's starting plan, in a language, for planning by hand. */
export function defaultBlueprint(
  id: AnimationCapability,
  language: string,
): AnimationBlueprint {
  return AnimationBlueprintSchema.parse({
    ...CAPABILITIES[id].defaults(),
    idea: "",
    language,
  });
}

/** Capitals for the video's language; a unit after a number stays as is. */
function capitals(line: string, language: string): string {
  return line
    .toLocaleUpperCase(language)
    .replace(
      /(\d)(S|SN|SEC)\b/g,
      (_, digit: string, unit: string) => digit + unit.toLowerCase(),
    )
    .replace(
      /(\d) (S|SN)\b/g,
      (_, digit: string, unit: string) => `${digit} ${unit.toLowerCase()}`,
    );
}

const BEAT_OF: Record<TextField, BlueprintBeat> = {
  hook: "hook",
  prediction: "prediction",
  explanation: "explanation",
  closing: "closing",
};

/**
 * The quality pipeline and the build: schema (by parsing), text integrity,
 * structure, contrast, the build itself, the capability's science, and the
 * layout preflight. Safe fixes are made and reported; anything else is
 * reported and left as written. The returned blueprint is what was built.
 */
export function compileBlueprint(
  input: unknown,
  overrides: Partial<QualityRules> = {},
): {
  spec: AnimationSpec;
  blueprint: AnimationBlueprint;
  notices: DirectorNotice[];
  quality: QualityReport;
} {
  const parsed = AnimationBlueprintSchema.parse(input);
  const rules = QualityRulesSchema.parse(overrides);
  const language = parsed.language;
  const findings: QualityFinding[] = [];
  const checks = ["schema", "text", "numbers", "structure", "contrast"];

  // Text integrity: in capitals for the video's language, each line checked.
  const text = {
    ...parsed.text,
    labels: [...parsed.text.labels] as [string, string],
  };
  const numbers = {} as Record<TextField, NumberClaim[]>;
  for (const field of TEXT_FIELDS) {
    const line = reviewLine(
      capitals(parsed.text[field], language),
      `text.${field}`,
      `${field}`,
      language,
      BEAT_OF[field],
    );
    text[field] = line.text;
    numbers[field] = line.numbers;
    findings.push(...line.findings);
  }
  parsed.text.labels.forEach((label, i) => {
    const line = reviewLine(
      label.toLocaleUpperCase(language),
      `text.labels.${i}`,
      i === 0 ? "first label" : "second label",
      language,
      null,
    );
    text.labels[i] = line.text;
    findings.push(...line.findings);
  });

  // Structure: two different contenders; each beat once.
  if (text.labels[0] === text.labels[1]) {
    findings.push({
      id: "structure.labels",
      severity: "error",
      category: "structure",
      scene: null,
      element: "text.labels",
      message:
        "Both labels are the same, so the two contenders cannot be told apart.",
      suggestion: "Give them different names.",
      fix: null,
    });
  }
  const beats = parsed.scenes.map((scene) => scene.beat);
  const repeated = beats.filter((beat, i) => beats.indexOf(beat) !== i);
  if (repeated.length > 0) {
    findings.push({
      id: "structure.beats",
      severity: "error",
      category: "structure",
      scene: repeated[0]!,
      element: "scenes",
      message: `The plan has the ${repeated[0]} twice.`,
      suggestion: "Keep one of each scene.",
      fix: null,
    });
  }
  const contrast = reviewContrast(parsed.style, rules);
  findings.push(...contrast.findings);

  const capability = CAPABILITIES[parsed.capability];
  const built = capability.compile({ ...parsed, text, style: contrast.style });
  // Art direction chooses between compositions; one look has nothing to
  // choose, which the plan is told rather than silently ignored.
  const { style, ...options } = parsed.direction;
  if (
    !capability.compositions?.length &&
    (style !== "educational" || Object.values(options).some(Boolean))
  ) {
    built.notices.push({
      severity: "info",
      message: `${capability.name} has one fixed look; the art direction (${style}) does not change it.`,
    });
  }

  // Science, from the experiment's own facts; may put verified words in.
  checks.push(`science:${capability.id}`);
  const science: ScienceInput = {
    blueprint: built.blueprint,
    spec: built.spec,
    text: { ...built.blueprint.text },
    numbers,
    words: labPhrases(language),
  };
  findings.push(...capability.science(science));
  if (JSON.stringify(science.text) !== JSON.stringify(built.blueprint.text)) {
    built.blueprint = AnimationBlueprintSchema.parse({
      ...built.blueprint,
      text: science.text,
    });
    built.spec = AnimationSpecSchema.parse({
      ...built.spec,
      lab: { ...built.spec.lab!, text: labText(science.text) },
      director: built.blueprint,
    });
  }

  checks.push("layout:representative-frames");
  findings.push(...capability.layout(built.spec, rules));

  if (!PHRASE_LANGUAGES.includes(language.slice(0, 2).toLowerCase())) {
    built.notices.push({
      severity: "info",
      message: `Results and labels are shown in English: there is no ${language} table for them yet.`,
    });
  }
  const unique = [...new Map(findings.map((f) => [f.id, f])).values()];
  // A problem already fixed is shown, but no longer blocks.
  const status = unique.some((f) => f.severity === "error" && !f.fix?.applied)
    ? "errors"
    : unique.length > 0
      ? "warnings"
      : "pass";
  return { ...built, quality: { status, findings: unique, checks } };
}
