/**
 * The AI Animation Director: from an idea in words to an animation
 * blueprint, with the local language model. The model only ever writes a
 * plan as JSON (held to a schema by the runtime's grammar); the plan is
 * then parsed, checked against the capability registry, normalized and
 * compiled by the renderer. Nothing the model writes is run, and results
 * such as who wins come from the experiments, never from the model.
 *
 * An idea no capability fits is answered as such, with the list of what
 * exists; it is never quietly turned into a different animation.
 */
import {
  ANIMATION_CAPABILITIES,
  type AnimationBlueprint,
  AnimationBlueprintSchema,
  type AnimationCapability,
  ART_STYLES,
  AppError,
  type ArtDirection,
  type ArtStyle,
  BLUEPRINT_BEATS,
  DIRECTION_KEYS,
  DIRECTION_OPTIONS,
  STYLE_PRESETS,
  resolveDirection,
  type DirectorNotice,
  type DirectorResult,
  type QualityFinding,
  type QualityReport,
  type ScenePlan,
} from "@framebop/core";
import {
  CAPABILITIES,
  SCREEN_TEXT_MAX,
  capabilityInfo,
  compileBlueprint,
  defaultBlueprint,
} from "@framebop/renderer";
import { z } from "zod";
import type { EngineContext } from "../context";
import type { BlueprintService } from "./blueprint";
import type { LocalLlmService, ManagedProvider } from "./llm";
import { SCRIPT_MODEL } from "./script-writer";

/** Plans that fail to parse or validate are asked for again, this often. */
export const DIRECTOR_ATTEMPTS = 3;

const LANGUAGE_NAMES = new Intl.DisplayNames(["en"], { type: "language" });

/** What the model is asked to write. Looser than a blueprint on purpose. */
const DraftSchema = z.object({
  capability: z.string(),
  reason: z.string().default(""),
  concept: z.object({
    title: z.string(),
    objective: z.string(),
    audience: z.string(),
    hook: z.string(),
  }),
  text: z.object({
    hook: z.string(),
    prediction: z.string(),
    explanation: z.string(),
    closing: z.string(),
    labels: z.array(z.string()).min(2),
  }),
  scenes: z
    .array(
      z.object({
        beat: z.string(),
        seconds: z.number(),
        note: z.string().default(""),
      }),
    )
    .default([]),
  style: z
    .object({
      primary: z.string().default(""),
      secondary: z.string().default(""),
    })
    .default({ primary: "", secondary: "" }),
  camera: z.string().default("gentle"),
  mood: z.string().default("bright"),
  parameters: z.record(z.string(), z.number()).default({}),
  /** A style and options; "auto" leaves an option to the style. */
  direction: z.record(z.string(), z.string()).default({}),
  /** Asked-for changes no option offers, in the model's words. */
  unsupported: z.array(z.string()).default([]),
});
type Draft = z.infer<typeof DraftSchema>;

/** Every composition any capability offers, for the grammar. */
function compositionNames(): string[] {
  return [
    ...new Set(
      Object.values(CAPABILITIES).flatMap((c) =>
        (c.compositions ?? []).map((x) => x.id),
      ),
    ),
  ];
}

/** The JSON schema the runtime's grammar holds the model to. */
export function draftJsonSchema(): Record<string, unknown> {
  // Room past the screen's limit, so the model ends its sentence and a long
  // line is asked for again whole instead of being cut off mid-word here.
  const text = { type: "string", minLength: 1, maxLength: 72 };
  const numbers: Record<string, unknown> = {};
  for (const capability of Object.values(CAPABILITIES)) {
    for (const p of capability.parameters) numbers[p.key] = { type: "number" };
  }
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "capability",
      "reason",
      "concept",
      "text",
      "scenes",
      "style",
      "camera",
      "mood",
      "parameters",
      "direction",
      "unsupported",
    ],
    properties: {
      capability: { enum: [...ANIMATION_CAPABILITIES, "none"] },
      reason: { type: "string", maxLength: 240 },
      concept: {
        type: "object",
        additionalProperties: false,
        required: ["title", "objective", "audience", "hook"],
        properties: {
          title: { type: "string", maxLength: 80 },
          objective: { type: "string", maxLength: 240 },
          audience: { type: "string", maxLength: 100 },
          hook: { type: "string", maxLength: 160 },
        },
      },
      text: {
        type: "object",
        additionalProperties: false,
        required: ["hook", "prediction", "explanation", "closing", "labels"],
        properties: {
          hook: text,
          prediction: text,
          explanation: text,
          closing: text,
          labels: {
            type: "array",
            items: { type: "string", maxLength: 16 },
            minItems: 2,
            maxItems: 2,
          },
        },
      },
      scenes: {
        type: "array",
        minItems: 3,
        maxItems: 6,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["beat", "seconds", "note"],
          properties: {
            beat: { enum: [...BLUEPRINT_BEATS] },
            seconds: { type: "number" },
            note: { type: "string", maxLength: 160 },
          },
        },
      },
      style: {
        type: "object",
        additionalProperties: false,
        required: ["primary", "secondary"],
        properties: {
          primary: { type: "string" },
          secondary: { type: "string" },
        },
      },
      camera: { enum: ["still", "gentle"] },
      mood: { enum: ["bright", "calm", "tense"] },
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: numbers,
      },
      direction: {
        type: "object",
        additionalProperties: false,
        required: ["style", "composition", ...DIRECTION_KEYS],
        properties: {
          style: { enum: [...ART_STYLES] },
          composition: { enum: ["auto", ...compositionNames()] },
          ...Object.fromEntries(
            DIRECTION_KEYS.map((key) => [
              key,
              { enum: ["auto", ...DIRECTION_OPTIONS[key]] },
            ]),
          ),
        },
      },
      unsupported: {
        type: "array",
        maxItems: 3,
        items: { type: "string", maxLength: 120 },
      },
    },
  };
}

/** What the planner is told about art direction. */
function directionPrompt(): string {
  const options = DIRECTION_KEYS.map(
    (key) => `${key}: ${DIRECTION_OPTIONS[key].join(" | ")}`,
  ).join("; ");
  const styles = ART_STYLES.map((style) => {
    const p = STYLE_PRESETS[style];
    return `  - ${style}: ${p.compositions[0]} composition, ${p.lighting} lighting, ${p.motion} camera, ${p.typography} type, ${p.reveal} reveal`;
  }).join("\n");
  return [
    "Art direction (direction): how the animation looks and moves, from these options only.",
    '- style is one of these presets; it sets every option you leave as "auto":',
    styles,
    `- Options (set one only to change it from the style): ${options}.`,
    '- composition: one the chosen capability lists, or "auto".',
  ].join("\n");
}

/** A plan's art direction from a draft: "auto" and unknown values unset. */
function directionFromDraft(
  draft: Draft["direction"],
  chosen: ArtStyle | undefined,
): ArtDirection {
  const style = (ART_STYLES as readonly string[]).includes(draft.style ?? "")
    ? (draft.style as ArtStyle)
    : "educational";
  const final = chosen ?? style;
  const preset = STYLE_PRESETS[final];
  // An option the same as the style's own is left to the style, so a later
  // "more cinematic" moves it too instead of it staying pinned.
  const out: Record<string, string> = { style: final };
  if (
    draft.composition &&
    draft.composition !== "auto" &&
    draft.composition !== preset.compositions[0]
  )
    out.composition = draft.composition;
  for (const key of DIRECTION_KEYS) {
    const value = draft[key];
    if (
      value &&
      value !== preset[key] &&
      (DIRECTION_OPTIONS[key] as readonly string[]).includes(value)
    )
      out[key] = value;
  }
  return out as ArtDirection;
}

/** How the planner is told what exists. */
export function directorPrompt(language: string): string {
  const languageName = LANGUAGE_NAMES.of(language) ?? language;
  const capabilities = Object.values(CAPABILITIES)
    .map((c) => {
      const parameters = c.parameters
        .map(
          (p) =>
            `    - ${p.key}: ${p.description}; ${p.min} to ${p.max}${p.unit ? ` ${p.unit}` : ""}, default ${p.default}`,
        )
        .join("\n");
      const beats = c.beats
        .map((b) =>
          b.fixed
            ? `${b.beat} (length set by the simulation)`
            : `${b.beat} ${b.min}-${b.max} s`,
        )
        .join(", ");
      return [
        `- "${c.id}": ${c.name}.`,
        `  Shows: ${c.summary}`,
        `  Fits ideas about: ${c.fits}`,
        `  labels[0] names ${c.labels[0]}; labels[1] names ${c.labels[1]}.`,
        `  Scenes, in this order: ${beats}.`,
        `  Parameters:\n${parameters}`,
        c.compositions?.length
          ? `  Compositions: ${c.compositions.map((x) => `"${x.id}" (${x.summary})`).join("; ")}.`
          : "  One fixed look: set direction to style educational and every option auto.",
      ].join("\n");
    })
    .join("\n");
  return [
    "You plan short vertical educational animations for Framebop Studio's AI Animation Director.",
    "You may only plan one of these capabilities. Each is a real, tested animation; you choose and configure it, you do not invent new kinds.",
    capabilities,
    "",
    "Rules:",
    `- Every word on screen is in ${languageName}: short phrases of at most five words and 32 characters, no emoji, as a viewer reads them on a phone. Labels are one or two words.`,
    "- The hook asks a question; the closing gives a memorable takeaway. Do not state measured results or numbers: the experiment computes them.",
    "- Never claim anything the science contradicts (the curved path always wins the race; the two lines of the illusion are always equal).",
    "- Use only the scenes listed for the capability, in order. Keep the whole video between 12 and 24 seconds.",
    "- style: two colours as #RRGGBB; keep primary #FF7A1F (Framebop orange) unless the idea asks for other colours.",
    "- parameters: only the chosen capability's keys.",
    '- If no capability fits the idea, set capability to "none", explain why in reason (one sentence), and fill the rest with short placeholders.',
    "- reason: one sentence on why the chosen capability fits the idea.",
    "",
    directionPrompt(),
    "",
    "Revising a plan:",
    "- Change only what is asked, and keep everything else as it is.",
    '- Map the request to the options above: "more cinematic" is style cinematic; "darker" is lighting moody; "less camera movement" is motion calm; "a bigger subject" is subject large; "a more dramatic reveal" is reveal dramatic.',
    "- If the request asks for something no option or parameter offers (a new character, 3D, another experiment, music), list it in unsupported, one short sentence each, and do not change anything for it.",
    "- unsupported is empty when everything asked is possible.",
  ].join("\n");
}

/** The JSON in a model's answer, without its reasoning or code fences. */
export function extractJson(text: string): unknown {
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start)
    throw new Error("The answer held no JSON object.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** A model's draft as a blueprint for its capability, or why it is not. */
export function blueprintFromDraft(
  draft: Draft,
  idea: string,
  language: string,
  /** The style the user chose, which the plan keeps. */
  style?: ArtStyle,
): { blueprint: AnimationBlueprint; notices: DirectorNotice[] } {
  const notices: DirectorNotice[] = [];
  const capability = draft.capability as AnimationCapability;
  if (!ANIMATION_CAPABILITIES.includes(capability)) {
    throw new Error(`"${draft.capability}" is not a capability.`);
  }
  const base = defaultBlueprint(capability, language);
  const known = new Set(CAPABILITIES[capability].parameters.map((p) => p.key));
  const parameters = Object.fromEntries(
    Object.entries(draft.parameters).filter(([key]) => known.has(key)),
  );
  const beats = new Set(CAPABILITIES[capability].beats.map((b) => b.beat));
  const scenes = draft.scenes.filter((s) => beats.has(s.beat as never));
  const color = (value: string, fallback: string, name: string) => {
    if (HEX.test(value)) return value.toUpperCase();
    if (value)
      notices.push({
        severity: "info",
        message: `The ${name} colour "${value}" is not #RRGGBB; ${fallback} is used.`,
      });
    return fallback;
  };
  const clip = (s: string, max: number) => s.trim().slice(0, max);
  // A screen line still too long after the retries: the capability's own
  // line when it is in the video's language (the ready-made lines are
  // English), since a cut line reads as a broken sentence; otherwise cut at
  // a word, and the text review flags it if it stops mid-sentence.
  const words = (
    key: "hook" | "prediction" | "explanation" | "closing",
  ): string => {
    const line = draft.text[key].trim().replace(/\s+/g, " ");
    if (line.length <= SCREEN_TEXT_MAX) return line || base.text[key];
    if (language.toLowerCase().startsWith("en")) {
      notices.push({
        severity: "warning",
        message: `The ${key} "${line}" was too long for the screen; the ready-made "${base.text[key]}" is used instead. Edit it if you like.`,
      });
      return base.text[key];
    }
    const cut = line.slice(0, SCREEN_TEXT_MAX + 1).lastIndexOf(" ");
    return line.slice(0, cut > 0 ? cut : SCREEN_TEXT_MAX);
  };
  const blueprint = AnimationBlueprintSchema.parse({
    ...base,
    idea,
    capability,
    concept: {
      title: clip(draft.concept.title, 80) || base.concept.title,
      objective: clip(draft.concept.objective, 300) || base.concept.objective,
      audience: clip(draft.concept.audience, 120) || base.concept.audience,
      hook: clip(draft.concept.hook, 200) || base.concept.hook,
    },
    text: {
      hook: words("hook"),
      prediction: words("prediction"),
      explanation: words("explanation"),
      closing: words("closing"),
      labels: [
        clip(draft.text.labels[0] ?? "", 20) || base.text.labels[0],
        clip(draft.text.labels[1] ?? "", 20) || base.text.labels[1],
      ],
    },
    scenes: scenes.length >= 3 ? scenes : base.scenes,
    style: {
      primary: color(draft.style.primary, base.style.primary, "primary"),
      secondary: color(
        draft.style.secondary,
        base.style.secondary,
        "secondary",
      ),
    },
    camera: draft.camera === "still" ? "still" : "gentle",
    audio: {
      mood: ["bright", "calm", "tense"].includes(draft.mood)
        ? draft.mood
        : "bright",
    },
    parameters,
    direction: directionFromDraft(draft.direction, style),
  });
  if (
    blueprint.text.labels[0].toUpperCase() ===
    blueprint.text.labels[1].toUpperCase()
  ) {
    throw new Error("The two labels must name different things.");
  }
  return { blueprint, notices };
}

/**
 * What a revision changed, in words, so a request that changed nothing (or
 * not what was asked) shows as such instead of passing for done.
 */
export function describeChanges(
  before: AnimationBlueprint,
  after: AnimationBlueprint,
): string[] {
  const out: string[] = [];
  if (before.capability !== after.capability)
    out.push(`animation ${before.capability} → ${after.capability}`);
  const offered = (b: AnimationBlueprint) =>
    (CAPABILITIES[b.capability].compositions ?? []).map((c) => c.id);
  if (offered(after).length > 0) {
    const a = resolveDirection(before.direction, offered(before)).direction;
    const b = resolveDirection(after.direction, offered(after)).direction;
    for (const key of ["style", "composition", ...DIRECTION_KEYS] as const)
      if (a[key] !== b[key]) out.push(`${key} ${a[key]} → ${b[key]}`);
  }
  for (const key of ["hook", "prediction", "explanation", "closing"] as const)
    if (before.text[key] !== after.text[key])
      out.push(`${key} "${after.text[key]}"`);
  if (before.text.labels.join() !== after.text.labels.join())
    out.push(`labels ${after.text.labels.join(", ")}`);
  for (const [key, value] of Object.entries(after.parameters))
    if (before.parameters[key] !== value)
      out.push(`${key} ${before.parameters[key] ?? "–"} → ${value}`);
  for (const scene of after.scenes) {
    const old = before.scenes.find((s) => s.beat === scene.beat);
    if (old && Math.abs(old.seconds - scene.seconds) > 0.05)
      out.push(`${scene.beat} ${old.seconds} s → ${scene.seconds} s`);
  }
  if (
    before.style.primary !== after.style.primary ||
    before.style.secondary !== after.style.secondary
  )
    out.push(`colours ${after.style.primary}, ${after.style.secondary}`);
  if (before.camera !== after.camera)
    out.push(`camera ${before.camera} → ${after.camera}`);
  return out;
}

export class DirectorService {
  private running: AbortController | null = null;

  constructor(
    private readonly ctx: EngineContext,
    private readonly llm: LocalLlmService,
    private readonly blueprints: BlueprintService,
  ) {}

  capabilities() {
    return capabilityInfo();
  }

  /** A capability's starting plan in the project's language. */
  defaults(
    sceneId: string,
    capability: AnimationCapability,
  ): AnimationBlueprint {
    return compileBlueprint(
      defaultBlueprint(capability, this.languageOf(sceneId)),
    ).blueprint;
  }

  /** Checks an edited plan and returns it as it would be built. */
  normalize(blueprint: unknown): {
    blueprint: AnimationBlueprint;
    notices: DirectorNotice[];
    quality: QualityReport;
  } {
    try {
      const {
        blueprint: settled,
        notices,
        quality,
      } = compileBlueprint(blueprint);
      return { blueprint: settled, notices, quality };
    } catch (error) {
      throw new AppError(
        "VALIDATION",
        `This plan is not valid: ${describe(error)}`,
      );
    }
  }

  /** Builds the scene's animation from a plan. */
  async apply(sceneId: string, blueprint: unknown): Promise<ScenePlan> {
    let built;
    try {
      built = compileBlueprint(blueprint);
    } catch (error) {
      throw new AppError(
        "VALIDATION",
        `This plan is not valid: ${describe(error)}`,
      );
    }
    // Output that would be broken or untrue is not built.
    const open = blocking(built.quality.findings);
    if (open.length > 0) {
      throw new AppError(
        "VALIDATION",
        `This plan has ${open.length} problem${open.length === 1 ? "" : "s"} to fix first: ${open.map((f) => f.message).join(" ")}`,
      );
    }
    this.ctx.log.scope("director").info("Built an animation from a plan", {
      sceneId,
      capability: built.blueprint.capability,
      frames: built.spec.durationFrames,
    });
    return this.blueprints.useAnimation(
      sceneId,
      built.spec,
      `lab-${built.blueprint.capability}`,
    );
  }

  /**
   * Plans an animation from an idea, or revises `previous` as asked. The
   * model's answer is checked; a broken one is asked for again, a few times.
   */
  async plan(input: {
    sceneId: string;
    idea: string;
    previous?: AnimationBlueprint | undefined;
    instruction?: string | undefined;
    modelId?: string | undefined;
    style?: ArtStyle | undefined;
  }): Promise<DirectorResult> {
    const language = this.languageOf(input.sceneId);
    if (this.running)
      throw new AppError("CONFLICT", "An animation is already being planned.");
    const controller = new AbortController();
    this.running = controller;
    try {
      return await this.llm.withModel(
        input.modelId ?? SCRIPT_MODEL,
        controller.signal,
        (provider) => this.draft(provider, input, language, controller.signal),
      );
    } finally {
      this.running = null;
    }
  }

  cancel(): void {
    this.running?.abort();
  }

  private async draft(
    provider: ManagedProvider,
    input: {
      idea: string;
      previous?: AnimationBlueprint | undefined;
      instruction?: string | undefined;
      style?: ArtStyle | undefined;
    },
    language: string,
    signal: AbortSignal,
  ): Promise<DirectorResult> {
    // A new plan keeps the style the user chose; a revision may change it.
    const style = input.previous ? undefined : input.style;
    const ask = input.previous
      ? [
          `The current plan, as JSON: ${JSON.stringify(input.previous)}`,
          `Revise it as asked, keeping everything else: ${input.instruction ?? input.idea}`,
        ].join("\n")
      : [
          `The idea: ${input.idea}`,
          ...(style ? [`Art style, chosen by the user: ${style}.`] : []),
        ].join("\n");
    const messages: {
      role: "system" | "user" | "assistant";
      content: string;
    }[] = [
      { role: "system", content: directorPrompt(language) },
      {
        role: "user",
        content: `${ask}\nAnswer with the JSON plan only.\n/no_think`,
      },
    ];
    let lastError = "";
    for (let attempt = 1; attempt <= DIRECTOR_ATTEMPTS; attempt += 1) {
      const result = await provider.generate({
        messages,
        maxTokens: 1400,
        temperature: attempt === 1 ? 0.4 : 0.2,
        jsonSchema: draftJsonSchema(),
        signal,
      });
      if (signal.aborted || result.finishReason === "cancelled") {
        throw new AppError("CANCELLED", "Planning the animation was stopped.");
      }
      try {
        const draft = DraftSchema.parse(extractJson(result.text));
        if (draft.capability === "none") {
          this.ctx.log
            .scope("director")
            .info("An idea fits no capability", { reason: draft.reason });
          return {
            status: "unsupported",
            reason:
              draft.reason.trim() ||
              "None of the animations Framebop can build fits this idea.",
            capabilities: capabilityInfo(),
          };
        }
        // Words too long for the screen are asked for again, shorter; on the
        // last try they are cut at a word instead.
        const long = (
          ["hook", "prediction", "explanation", "closing"] as const
        ).filter((key) => draft.text[key].trim().length > SCREEN_TEXT_MAX);
        if (long.length > 0 && attempt < DIRECTOR_ATTEMPTS) {
          throw new Error(
            `these lines are too long for the screen (at most five words, ${SCREEN_TEXT_MAX} characters): ${long.map((key) => `${key} "${draft.text[key].trim()}"`).join(", ")}. Rewrite each as a shorter, complete phrase, not the same words cut off`,
          );
        }
        const { blueprint, notices } = blueprintFromDraft(
          draft,
          input.idea,
          language,
          style,
        );
        // Asked-for changes nothing offers are said, never quietly dropped.
        for (const item of draft.unsupported.filter((u) => u.trim()))
          notices.push({
            severity: "warning",
            message: `Not supported: ${item.trim()}`,
          });
        const built = compileBlueprint(blueprint);
        // Problems that block the build go back to the model, a few times;
        // after the last try the plan is shown with them, for the user.
        const open = blocking(built.quality.findings);
        if (open.length > 0 && attempt < DIRECTOR_ATTEMPTS) {
          throw new Error(
            `it has problems: ${open.map((f) => `${f.message}${f.suggestion ? ` ${f.suggestion}` : ""}`).join(" ")}`,
          );
        }
        this.ctx.log.scope("director").info("Planned an animation", {
          capability: built.blueprint.capability,
          attempts: attempt,
          quality: built.quality.status,
          findings: built.quality.findings.length,
        });
        if (input.previous) {
          const changes = describeChanges(input.previous, built.blueprint);
          notices.push(
            changes.length > 0
              ? { severity: "info", message: `Changed: ${changes.join("; ")}.` }
              : {
                  severity: "warning",
                  message:
                    "Nothing in the plan changed: the request matched no option this animation offers.",
                },
          );
        }
        return {
          status: "planned",
          blueprint: built.blueprint,
          notices: [...notices, ...built.notices],
          quality: built.quality,
          attempts: attempt,
        };
      } catch (error) {
        lastError = describe(error);
        this.ctx.log
          .scope("director")
          .warn("A plan was not usable", { attempt, reason: lastError });
        messages.push(
          { role: "assistant", content: result.text.slice(0, 4000) },
          {
            role: "user",
            content: `That plan was not usable: ${lastError}. Answer again with a corrected JSON plan only.\n/no_think`,
          },
        );
      }
    }
    throw new AppError(
      "ENGINE_FAILURE",
      `The language model did not produce a usable plan after ${DIRECTOR_ATTEMPTS} tries (${lastError}). Try again, rephrase the idea, or start from a capability and edit it by hand.`,
    );
  }

  private languageOf(sceneId: string): string {
    const scene = this.ctx.db.scenes.get(sceneId);
    const episode = scene ? this.ctx.db.episodes.get(scene.episodeId) : null;
    const project = episode
      ? this.ctx.db.projects.get(episode.projectId)
      : null;
    if (!project)
      throw new AppError("NOT_FOUND", "That scene no longer exists.");
    return project.language;
  }
}

function describe(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "plan"}: ${issue.message}`)
      .join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}

/** Findings that stop a build: errors not already fixed. */
function blocking(findings: readonly QualityFinding[]): QualityFinding[] {
  return findings.filter((f) => f.severity === "error" && !f.fix?.applied);
}
