/**
 * Art direction: how an animation looks and moves, chosen from options the
 * renderer really has. A style is a preset of every option; a plan may set
 * any option itself. The composer turns the resolved choices into scene
 * graph data (which composition, which layers, how the camera moves, how
 * words enter), so a style changes the picture, not only its colours.
 */
import { z } from "zod";

export const ART_STYLES = [
  "educational",
  "cinematic",
  "playful",
  "dramatic",
  "premium",
] as const;
export const ArtStyleSchema = z.enum(ART_STYLES);
export type ArtStyle = z.infer<typeof ArtStyleSchema>;

/** Every choice a direction makes, with the options the renderer has. */
export const DIRECTION_OPTIONS = {
  /** How large the subject is: scales the scene's subject size. */
  subject: ["small", "medium", "large"],
  /** How close the camera frames the scene. */
  framing: ["wide", "medium", "close"],
  /** How many layers of depth: haze, foreground, atmosphere. */
  depth: ["flat", "layered", "deep"],
  /** Light: even and clear, a pool of light, or dark and warm. */
  lighting: ["even", "spotlight", "moody"],
  /** How much the camera moves. */
  motion: ["calm", "lively", "bold"],
  /** How headlines look and enter. */
  typography: ["clean", "kinetic", "cinematic"],
  /** How the result is revealed. */
  reveal: ["simple", "build", "dramatic"],
  /** How one headline gives way to the next. */
  transition: ["cut", "fade", "slide"],
} as const;
export type DirectionKey = keyof typeof DIRECTION_OPTIONS;
export const DIRECTION_KEYS = Object.keys(DIRECTION_OPTIONS) as DirectionKey[];

const option = <K extends DirectionKey>(key: K) =>
  z.enum(DIRECTION_OPTIONS[key]).optional();

/** A short name, as compositions and scene ids are named. */
const Name = z.string().regex(/^[a-z][a-z0-9-]{0,23}$/);

export const ArtDirectionSchema = z.object({
  style: ArtStyleSchema.default("educational"),
  /** One of the capability's compositions; the style's first choice if unset. */
  composition: Name.optional(),
  subject: option("subject"),
  framing: option("framing"),
  depth: option("depth"),
  lighting: option("lighting"),
  motion: option("motion"),
  typography: option("typography"),
  reveal: option("reveal"),
  transition: option("transition"),
});
export type ArtDirection = z.infer<typeof ArtDirectionSchema>;

export type ResolvedDirection = {
  style: ArtStyle;
  composition: string;
} & { [K in DirectionKey]: (typeof DIRECTION_OPTIONS)[K][number] };

type Preset = Omit<ResolvedDirection, "style" | "composition"> & {
  /** Compositions in order of preference. */
  compositions: readonly string[];
};

/** What each style chooses when a plan leaves an option unset. */
export const STYLE_PRESETS: Record<ArtStyle, Preset> = {
  educational: {
    compositions: ["diagram", "stage"],
    subject: "medium",
    framing: "medium",
    depth: "flat",
    lighting: "even",
    motion: "calm",
    typography: "clean",
    reveal: "build",
    transition: "fade",
  },
  cinematic: {
    compositions: ["stage", "diagram"],
    subject: "medium",
    framing: "close",
    depth: "deep",
    lighting: "moody",
    motion: "lively",
    typography: "cinematic",
    reveal: "dramatic",
    transition: "fade",
  },
  playful: {
    compositions: ["stage", "diagram"],
    subject: "large",
    framing: "medium",
    depth: "layered",
    lighting: "spotlight",
    motion: "bold",
    typography: "kinetic",
    reveal: "build",
    transition: "slide",
  },
  dramatic: {
    compositions: ["stage", "diagram"],
    subject: "medium",
    framing: "close",
    depth: "deep",
    lighting: "moody",
    motion: "bold",
    typography: "kinetic",
    reveal: "dramatic",
    transition: "cut",
  },
  premium: {
    compositions: ["diagram", "stage"],
    subject: "medium",
    framing: "medium",
    depth: "layered",
    lighting: "spotlight",
    motion: "calm",
    typography: "cinematic",
    reveal: "build",
    transition: "slide",
  },
};

/**
 * Every option filled: the plan's own choices, the style's for the rest,
 * and a composition the capability offers. `offered` lists the capability's
 * compositions; a requested one it lacks is reported, not invented.
 */
export function resolveDirection(
  direction: ArtDirection | undefined,
  offered: readonly string[],
): { direction: ResolvedDirection; problems: string[] } {
  const d = ArtDirectionSchema.parse(direction ?? {});
  const preset = STYLE_PRESETS[d.style];
  const problems: string[] = [];
  let composition = d.composition;
  if (composition && !offered.includes(composition)) {
    problems.push(
      `This animation has no "${composition}" composition (it has ${offered.map((c) => `"${c}"`).join(", ")}).`,
    );
    composition = undefined;
  }
  composition ??=
    preset.compositions.find((c) => offered.includes(c)) ?? offered[0] ?? "";
  const resolved = { style: d.style, composition } as ResolvedDirection;
  for (const key of DIRECTION_KEYS) {
    (resolved as Record<string, string>)[key] = d[key] ?? preset[key];
  }
  return { direction: resolved, problems };
}
