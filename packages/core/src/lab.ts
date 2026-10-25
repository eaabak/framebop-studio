/**
 * Framebop Lab: short experiments told as question, prediction, experiment,
 * reveal and explanation. An experiment is a typed configuration; the
 * renderer simulates it ahead of time and draws every frame from the
 * simulation, so the result on screen is the result of the physics.
 */
import { z } from "zod";
import { IdSchema } from "./domain";
import { SceneGraphSchema } from "./scene";

const Frame = z.number().int().min(0).max(100_000);
const Line = z.string().min(1).max(60);

/** The frames each part of the story starts at, in the spec's frames. */
export const LabBeatsSchema = z
  .object({
    prediction: Frame,
    experiment: Frame,
    reveal: Frame,
    explanation: Frame,
    closing: Frame,
  })
  .refine(
    (b) =>
      b.prediction < b.experiment &&
      b.experiment < b.reveal &&
      b.reveal < b.explanation &&
      b.explanation < b.closing,
    "The parts of a Lab experiment must come in order.",
  );
export type LabBeats = z.infer<typeof LabBeatsSchema>;

/** The words on screen, one short line per part. */
export const LabTextSchema = z.object({
  hook: Line,
  prediction: Line,
  explanation: Line,
  closing: Line,
  /** Names of the two contenders, as the labels show them. */
  contenders: z.tuple([Line, Line]),
});
export type LabText = z.infer<typeof LabTextSchema>;

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "A colour like #FF7A1F.");

/** The two accent colours of an experiment: its two contenders. */
export const LabStyleSchema = z
  .object({
    primary: Hex.default("#FF7A1F"),
    secondary: Hex.default("#14D9CF"),
  })
  .default({ primary: "#FF7A1F", secondary: "#14D9CF" });
export type LabStyle = z.infer<typeof LabStyleSchema>;

/** "still" holds one composition; "gentle" eases it with the story. */
export const LabCameraSchema = z.enum(["still", "gentle"]).default("gentle");
export type LabCamera = z.infer<typeof LabCameraSchema>;

/** Fields every experiment has, after its own. */
const common = {
  beats: LabBeatsSchema,
  text: LabTextSchema,
  style: LabStyleSchema,
  camera: LabCameraSchema,
  /** The language of the words in the picture, such as "en" or "tr". */
  language: z.string().min(2).max(12).default("en"),
  /** The experiment's sound design: a WAV in the library, timed to it. */
  soundAssetId: IdSchema.nullable().default(null),
};

/**
 * Two point masses slide without friction from rest, under uniform gravity,
 * from the same start to the same finish lower down: one along the straight
 * line, one along the cycloid through both points (the brachistochrone).
 */
export const BrachistochroneLabSchema = z.object({
  kind: z.literal("brachistochrone"),
  /** Horizontal distance from start to finish, in metres. */
  span: z.number().positive().max(100),
  /** How far the finish lies below the start, in metres. */
  drop: z.number().positive().max(100),
  /** Metres per second squared. */
  gravity: z.number().positive().max(100).default(9.81),
  /**
   * Seconds of video per simulated second, the same for both objects. The
   * screen says so whenever the experiment runs slower than real time.
   */
  slowMotion: z.number().min(1).max(20).default(1),
  /**
   * The replay in the explanation, which marks both objects at the same
   * moments: the same simulation, this many times slower than real time.
   */
  replaySlowMotion: z.number().min(1).max(40).default(5),
  /** The frame both objects are let go at, in the spec's frames. */
  releaseFrame: Frame,
  ...common,
});
export type BrachistochroneLab = z.infer<typeof BrachistochroneLabSchema>;

/**
 * The Müller-Lyer illusion: two shafts of exactly the same length, one with
 * fins pointing outwards (it looks longer), one with fins pointing inwards
 * (it looks shorter). Only the fins differ; the shafts never do.
 */
export const MullerLyerLabSchema = z.object({
  kind: z.literal("muller-lyer"),
  /** Length of both shafts, as a share of the picture's width. */
  shaft: z.number().min(0.35).max(0.7).default(0.55),
  /** Angle between each fin and its shaft, in degrees. */
  finAngle: z.number().min(15).max(60).default(35),
  /** Length of each fin, as a share of the shaft. */
  fin: z.number().min(0.1).max(0.35).default(0.2),
  /** Distance between the two figures, as a share of the picture's height. */
  gap: z.number().min(0.12).max(0.3).default(0.18),
  /** Whether the top figure is the one that looks longer. */
  longerOnTop: z.boolean().default(true),
  ...common,
});
export type MullerLyerLab = z.infer<typeof MullerLyerLabSchema>;

/**
 * A scene built from primitives: a declarative scene graph, the values of
 * its parameters, and the timeline as planned. No code: the renderer draws
 * it from the graph, and verified solvers supply any scientific values.
 */
export const SceneLabSchema = z.object({
  kind: z.literal("scene"),
  graph: SceneGraphSchema,
  /** Parameter values by name; a missing one takes its default. */
  values: z.record(z.string(), z.number()).default({}),
  ...common,
});
export type SceneLab = z.infer<typeof SceneLabSchema>;

export const LabExperimentSchema = z.discriminatedUnion("kind", [
  BrachistochroneLabSchema,
  MullerLyerLabSchema,
  SceneLabSchema,
]);
export type LabExperiment = z.infer<typeof LabExperimentSchema>;
