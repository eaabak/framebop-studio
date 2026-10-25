import { afterAll, describe, expect, it } from "vitest";
import {
  call,
  openTestEngine,
  removeTemporaryDirectories,
  temporaryDirectory,
} from "../testing";
import { DirectorService, draftJsonSchema, extractJson } from "./director";
import type { LocalLlmService, ManagedProvider } from "./llm";

afterAll(removeTemporaryDirectories);

/** A model that answers with the given texts in turn. */
function scripted(answers: string[]) {
  const asked: string[] = [];
  const provider = {
    generate: async (request: { messages: readonly { content: string }[] }) => {
      asked.push(request.messages.at(-1)!.content);
      const text = answers.shift() ?? "";
      return {
        text,
        promptTokens: 1,
        completionTokens: 1,
        finishReason: "stop" as const,
      };
    },
  } as unknown as ManagedProvider;
  const llm = {
    withModel: async (
      _id: string,
      _signal: AbortSignal,
      work: (p: ManagedProvider) => Promise<unknown>,
    ) => work(provider),
  } as unknown as LocalLlmService;
  return { llm, asked };
}

const RACE = {
  capability: "brachistochrone",
  reason: "A race between a straight and a curved path is the brachistochrone.",
  concept: {
    title: "The faster curve",
    objective: "Show that a curved path beats a straight one downhill.",
    audience: "Teenagers",
    hook: "Two balls race down two paths.",
  },
  text: {
    hook: "Which ramp is faster?",
    prediction: "Straight or curved?",
    explanation: "Early fall, early speed.",
    closing: "Shortest is not fastest.",
    labels: ["Straight", "Curve"],
  },
  scenes: [
    { beat: "hook", seconds: 1.5, note: "" },
    { beat: "experiment", seconds: 4, note: "" },
    { beat: "reveal", seconds: 2, note: "" },
    { beat: "explanation", seconds: 7, note: "" },
    { beat: "closing", seconds: 3, note: "" },
  ],
  style: { primary: "#FF7A1F", secondary: "#14D9CF" },
  camera: "gentle",
  mood: "tense",
  parameters: { span: 2.4, drop: 1.2, slowMotion: 6, shaft: 0.5 },
};

const ILLUSION = {
  ...RACE,
  capability: "muller-lyer",
  reason: "Equal lines that look different is the Müller-Lyer illusion.",
  text: {
    hook: "Which line is longer?",
    prediction: "Top or bottom?",
    explanation: "The fins trick your eyes.",
    closing: "Context changes what you see.",
    labels: ["Top", "Bottom"],
  },
  scenes: [
    { beat: "hook", seconds: 1.6, note: "" },
    { beat: "prediction", seconds: 2, note: "" },
    { beat: "experiment", seconds: 3, note: "" },
    { beat: "reveal", seconds: 2.5, note: "" },
    { beat: "explanation", seconds: 4, note: "" },
    { beat: "closing", seconds: 2.5, note: "" },
  ],
  style: { primary: "#FF7A1F", secondary: "purple" },
  parameters: {
    shaft: 0.55,
    fin: 0.25,
    finAngle: 30,
    gap: 0.2,
    longerOnTop: 0,
  },
};

const SHADOW = {
  ...RACE,
  capability: "point-light-shadow",
  reason: "A shadow that grows near a light is point-light projection.",
  text: {
    hook: "Why does a shadow grow?",
    prediction: "Watch it near the light",
    explanation: "The rays spread out",
    closing: "Closer light, bigger shadow",
    labels: ["Object", "Shadow"],
  },
  scenes: [
    { beat: "hook", seconds: 2, note: "" },
    { beat: "experiment", seconds: 6, note: "" },
    { beat: "reveal", seconds: 2, note: "" },
    { beat: "explanation", seconds: 4, note: "" },
    { beat: "closing", seconds: 2.5, note: "" },
  ],
  parameters: {},
  direction: {
    style: "educational",
    composition: "auto",
    subject: "auto",
    framing: "auto",
    depth: "auto",
    lighting: "auto",
    motion: "auto",
    typography: "auto",
    reveal: "auto",
    transition: "auto",
  },
  unsupported: [],
};

async function scene() {
  const engine = await openTestEngine(await temporaryDirectory());
  const project = await call(engine, "projects.create", {
    name: "Director",
    language: "en",
  });
  const episode = await call(engine, "episodes.create", {
    projectId: project.id,
    title: "One",
  });
  const made = await call(engine, "scenes.create", { episodeId: episode.id });
  return { engine, sceneId: made.id };
}

describe("AI Animation Director", () => {
  it("reads JSON out of a model's answer", () => {
    expect(extractJson('<think>hm</think>\n```json\n{"a": 1}\n```')).toEqual({
      a: 1,
    });
    expect(() => extractJson("no plan here")).toThrow();
    const schema = draftJsonSchema() as {
      properties: { capability: { enum: string[] } };
    };
    expect(schema.properties.capability.enum).toEqual([
      "brachistochrone",
      "muller-lyer",
      "point-light-shadow",
      "none",
    ]);
  });

  it("plans the race from an idea, with the simulation's timing", async () => {
    const { engine, sceneId } = await scene();
    const { llm } = scripted([`<think></think>${JSON.stringify(RACE)}`]);
    const director = new DirectorService(engine.context, llm, null as never);
    const result = await director.plan({
      sceneId,
      idea: "Create a surprising race between a straight path and a faster curved path.",
    });
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.blueprint.capability).toBe("brachistochrone");
    expect(result.attempts).toBe(1);
    // The other capability's parameter was dropped; numbers kept in range.
    expect(result.blueprint.parameters).not.toHaveProperty("shaft");
    expect(result.blueprint.parameters.span).toBe(2.4);
    expect(result.blueprint.text.hook).toBe("WHICH RAMP IS FASTER?");
    await engine.close();
  });

  it("asks again after a broken answer, and fixes what it can", async () => {
    const { engine, sceneId } = await scene();
    const { llm, asked } = scripted(["not a plan", JSON.stringify(ILLUSION)]);
    const director = new DirectorService(engine.context, llm, null as never);
    const result = await director.plan({
      sceneId,
      idea: "Create an optical illusion where two equal lines appear to have different lengths.",
    });
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.attempts).toBe(2);
    expect(asked[1]).toContain("not usable");
    expect(result.blueprint.capability).toBe("muller-lyer");
    expect(result.blueprint.parameters.longerOnTop).toBe(0);
    // "purple" is not a colour the renderer takes; the default stands.
    expect(result.blueprint.style.secondary).toBe("#14D9CF");
    expect(result.notices.some((n) => n.message.includes("purple"))).toBe(true);
    await engine.close();
  });

  it("asks again, shorter, when the words are too long for the screen", async () => {
    const { engine, sceneId } = await scene();
    const wordy = {
      ...ILLUSION,
      text: {
        ...ILLUSION.text,
        closing: "The two lines are exactly the same length after all",
      },
    };
    const { llm, asked } = scripted([
      JSON.stringify(wordy),
      JSON.stringify(ILLUSION),
    ]);
    const director = new DirectorService(engine.context, llm, null as never);
    const result = await director.plan({
      sceneId,
      idea: "Two equal lines that look different",
    });
    expect(result.status === "planned" && result.attempts).toBe(2);
    expect(asked[1]).toContain("too long");
    await engine.close();
  });

  it("never cuts a line that stays too long; the ready-made one stands in", async () => {
    const { engine, sceneId } = await scene();
    const wordy = {
      ...ILLUSION,
      text: {
        ...ILLUSION.text,
        hook: "Why do two equal lines look like they differ when",
      },
    };
    const { llm, asked } = scripted(Array(3).fill(JSON.stringify(wordy)));
    const director = new DirectorService(engine.context, llm, null as never);
    const result = await director.plan({
      sceneId,
      idea: "Two equal lines that look different",
    });
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.attempts).toBe(3);
    // The retry quotes the line, so the model knows what to shorten.
    expect(asked[1]).toContain('hook "Why do two equal lines');
    expect(result.blueprint.text.hook).toBe("WHICH LINE IS LONGER?");
    expect(result.notices.some((n) => n.message.includes("too long"))).toBe(
      true,
    );
    expect(
      result.quality.findings.filter((f) => f.severity === "error"),
    ).toEqual([]);
    await engine.close();
  });

  it("keeps the style the user chose, which picks the composition", async () => {
    const { engine, sceneId } = await scene();
    const { llm, asked } = scripted([JSON.stringify(SHADOW)]);
    const director = new DirectorService(engine.context, llm, null as never);
    const result = await director.plan({
      sceneId,
      idea: "Why does a small object's shadow grow near a light?",
      style: "cinematic",
    });
    expect(asked[0]).toContain("Art style, chosen by the user: cinematic");
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.blueprint.direction.style).toBe("cinematic");
    const built = await call(engine, "director.normalize", {
      blueprint: result.blueprint,
    });
    expect(built.quality.status).not.toBe("errors");
    await engine.close();
  });

  it("says what a revision changed, and what it could not do", async () => {
    const { engine, sceneId } = await scene();
    const previous = (await call(engine, "director.defaults", {
      sceneId,
      capability: "point-light-shadow",
    })) as never;
    const calmer = {
      ...SHADOW,
      direction: { ...SHADOW.direction, style: "cinematic", motion: "calm" },
      unsupported: ["A 3D character with arms and legs"],
    };
    const { llm } = scripted([JSON.stringify(calmer), JSON.stringify(SHADOW)]);
    const director = new DirectorService(engine.context, llm, null as never);
    const revised = await director.plan({
      sceneId,
      idea: "shadow",
      previous,
      instruction: "More cinematic, less camera movement, and a 3D character",
    });
    if (revised.status !== "planned") throw new Error("Not planned.");
    const messages = revised.notices.map((n) => n.message);
    expect(
      messages.some((m) => m.startsWith("Not supported: A 3D character")),
    ).toBe(true);
    const changed = messages.find((m) => m.startsWith("Changed:"))!;
    expect(changed).toContain("style educational → cinematic");
    expect(changed).toContain("composition diagram → stage");
    // Asked to move less: cinematic would move more, so motion stays calm.
    expect(changed).not.toContain("motion");
    // A request nothing offers, answered with the plan as it was.
    const same = await (async () => {
      const again = scripted([JSON.stringify({ ...calmer, unsupported: [] })]);
      return new DirectorService(engine.context, again.llm, null as never).plan(
        {
          sceneId,
          idea: "shadow",
          previous: revised.blueprint,
          instruction: "Add music",
        },
      );
    })();
    if (same.status !== "planned") throw new Error("Not planned.");
    expect(
      same.notices.some((n) =>
        n.message.startsWith("Nothing in the plan changed"),
      ),
    ).toBe(true);
    await engine.close();
  });

  it("says so when no capability fits, instead of choosing one", async () => {
    const { engine, sceneId } = await scene();
    const { llm } = scripted([
      JSON.stringify({
        ...RACE,
        capability: "none",
        reason: "Volcanoes are not something these animations show.",
      }),
    ]);
    const director = new DirectorService(engine.context, llm, null as never);
    const result = await director.plan({
      sceneId,
      idea: "How volcanoes erupt",
    });
    expect(result.status).toBe("unsupported");
    if (result.status !== "unsupported") return;
    expect(result.reason).toContain("Volcanoes");
    expect(result.capabilities.map((c) => c.id)).toEqual([
      "brachistochrone",
      "muller-lyer",
      "point-light-shadow",
    ]);
    await engine.close();
  });

  it("gives up after a bounded number of tries", async () => {
    const { engine, sceneId } = await scene();
    const same = {
      ...ILLUSION,
      text: { ...ILLUSION.text, labels: ["A", "a"] },
    };
    const { llm } = scripted([
      JSON.stringify(same),
      JSON.stringify(same),
      JSON.stringify(same),
      JSON.stringify(ILLUSION),
    ]);
    const director = new DirectorService(engine.context, llm, null as never);
    await expect(
      director.plan({ sceneId, idea: "Two equal lines that look different" }),
    ).rejects.toThrow(/after 3 tries/);
    await engine.close();
  });

  it("builds and keeps a scene from a plan through the engine", async () => {
    const { engine, sceneId } = await scene();
    const plan = await call(engine, "director.defaults", {
      sceneId,
      capability: "muller-lyer",
    });
    plan.parameters.fin = 0.3;
    plan.text.closing = "Same lines, new story.";
    const checked = await call(engine, "director.normalize", {
      blueprint: plan,
    });
    expect(checked.blueprint.text.closing).toBe("SAME LINES, NEW STORY.");
    const applied = await call(engine, "director.apply", {
      sceneId,
      blueprint: checked.blueprint,
    });
    const lab = applied.animation?.lab;
    expect(lab?.kind).toBe("muller-lyer");
    if (lab?.kind !== "muller-lyer") return;
    expect(lab.fin).toBe(0.3);
    expect(lab.soundAssetId).not.toBeNull();
    // The plan is kept with the scene, to edit again later.
    const preview = await call(engine, "blueprint.animationPreview", {
      sceneId,
    });
    expect(preview.animation?.director?.text.closing).toBe(
      "SAME LINES, NEW STORY.",
    );
    expect(preview.frames).toBe(applied.animation!.durationFrames);
    // An invalid plan is refused, not built.
    await expect(
      call(engine, "director.apply", {
        sceneId,
        blueprint: { ...plan, capability: "volcano" },
      }),
    ).rejects.toThrow(/not valid/);
    await engine.close();
  });
});
