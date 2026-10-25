import { describe, expect, it } from "vitest";
import { compileBlueprint, defaultBlueprint } from "./capabilities";
import { mullerFigures } from "./muller/geometry";
import { arrivalFrame, brachistochroneRun } from "./experiments";

const W = 1080;
const H = 1920;
const length = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(b.x - a.x, b.y - a.y);

describe("brachistochrone capability", () => {
  it("builds the race from a plan, timed by the simulation", () => {
    const { spec, blueprint } = compileBlueprint(
      defaultBlueprint("brachistochrone", "en"),
    );
    const lab = spec.lab!;
    if (lab.kind !== "brachistochrone") throw new Error("Not the race.");
    const run = brachistochroneRun(lab);
    // The curve wins, and both arrive before the result is shown.
    expect(run.curve.arrival).toBeLessThan(run.straight.arrival);
    expect(arrivalFrame(lab, run.straight, spec.fps)).toBeLessThan(
      lab.beats.reveal,
    );
    // The explanation's replay fits inside the explanation.
    const replay =
      (run.straight.arrival + 0.02) * lab.replaySlowMotion * spec.fps;
    expect(lab.beats.explanation + 18 + replay).toBeLessThan(lab.beats.closing);
    // The settled plan says how long the race really takes.
    const race = blueprint.scenes.find((s) => s.beat === "experiment")!;
    expect(race.seconds * spec.fps).toBeCloseTo(
      lab.beats.reveal - lab.releaseFrame,
      0,
    );
    expect(spec.director?.capability).toBe("brachistochrone");
  });

  it("refuses words that contradict the simulation", () => {
    const plan = defaultBlueprint("brachistochrone", "en");
    plan.text.closing = "STRAIGHT IS FASTER!";
    const { spec, quality } = compileBlueprint(plan);
    // Replaced by the measured result, and the change is shown.
    expect(spec.lab!.text.closing).toBe("CURVED WINS BY 0.18 s");
    const found = quality.findings.find(
      (f) => f.id === "science.contradiction:text.closing",
    );
    expect(found?.fix?.applied).toBe(true);
  });
});

describe("Müller-Lyer capability", () => {
  it("keeps both shafts exactly equal, whatever the fins do", () => {
    for (const [fin, finAngle, shaft] of [
      [0.1, 15, 0.35],
      [0.35, 15, 0.7],
      [0.2, 35, 0.55],
      [0.35, 60, 0.7],
    ] as const) {
      const plan = defaultBlueprint("muller-lyer", "en");
      plan.parameters = { fin, finAngle, shaft, gap: 0.2, longerOnTop: 1 };
      const { spec } = compileBlueprint(plan);
      const lab = spec.lab!;
      if (lab.kind !== "muller-lyer") throw new Error("Not the illusion.");
      for (const flex of [-2, 0, 2]) {
        const { top, bottom } = mullerFigures(lab, W, H, flex);
        expect(length(top.from, top.to)).toBeCloseTo(
          length(bottom.from, bottom.to),
          9,
        );
        // One looks longer, one shorter: only the fins point differently.
        expect(top.outward).not.toBe(bottom.outward);
        // Fins and all, both figures stay inside the picture.
        for (const figure of [top, bottom]) {
          for (const [, tip] of figure.fins) {
            expect(tip.x).toBeGreaterThan(0);
            expect(tip.x).toBeLessThan(W);
          }
        }
      }
    }
  });

  it("follows the plan: numbers, colours, timing and words change the video", () => {
    const a = compileBlueprint(defaultBlueprint("muller-lyer", "en")).spec;
    const plan = defaultBlueprint("muller-lyer", "tr");
    plan.parameters = {
      shaft: 0.45,
      fin: 0.3,
      finAngle: 25,
      gap: 0.24,
      longerOnTop: 0,
    };
    plan.style = { primary: "#FF7A1F", secondary: "#A06BFF" };
    plan.scenes = plan.scenes.map((s) =>
      s.beat === "explanation" ? { ...s, seconds: 5.5 } : s,
    );
    plan.text.hook = "hangi çizgi daha uzun?";
    const b = compileBlueprint(plan).spec;
    const la = a.lab!;
    const lb = b.lab!;
    if (la.kind !== "muller-lyer" || lb.kind !== "muller-lyer")
      throw new Error("Not the illusion.");
    expect(lb.longerOnTop).toBe(false);
    expect(lb.fin).toBe(0.3);
    expect(lb.style.secondary).toBe("#A06BFF");
    expect(b.durationFrames).toBe(a.durationFrames + 45);
    // Capitals for the video's language: the Turkish dotted İ.
    expect(lb.text.hook).toBe("HANGİ ÇİZGİ DAHA UZUN?");
    expect(lb.language).toBe("tr");
  });

  it("clamps numbers out of range and says so", () => {
    const plan = defaultBlueprint("muller-lyer", "en");
    plan.parameters = {
      shaft: 3,
      fin: -1,
      finAngle: 400,
      gap: 0.2,
      longerOnTop: 1,
    };
    const { spec, notices } = compileBlueprint(plan);
    const lab = spec.lab!;
    if (lab.kind !== "muller-lyer") throw new Error("Not the illusion.");
    expect(lab.fin).toBe(0.1);
    expect(lab.finAngle).toBe(60);
    expect(lab.shaft).toBeLessThanOrEqual(0.7);
    expect(notices.length).toBeGreaterThanOrEqual(3);
  });

  it("refuses an explanation that calls one line longer", () => {
    const plan = defaultBlueprint("muller-lyer", "en");
    plan.text.explanation = "A IS LONGER THAN B";
    const { spec, quality } = compileBlueprint(plan);
    expect(spec.lab!.text.explanation).toBe("SAME LENGTH");
    expect(
      quality.findings.some(
        (f) => f.id === "science.unequalClaim:text.explanation",
      ),
    ).toBe(true);
  });
});

const race = () => {
  const plan = defaultBlueprint("brachistochrone", "en");
  plan.text.labels = ["STRAIGHT PATH", "CURVED PATH"];
  return plan;
};
const ids = (quality: { findings: { id: string }[] }) =>
  quality.findings.map((f) => f.id);

describe("quality: content", () => {
  it("A: flags a universal claim and replaces it with the measured result", () => {
    const plan = race();
    plan.text.closing = "CURVED PATH ALWAYS WINS!";
    const { spec, quality } = compileBlueprint(plan);
    const found = quality.findings.find(
      (f) => f.id === "science.universal:text.closing",
    )!;
    expect(found.severity).toBe("error");
    expect(found.fix).toEqual({
      field: "text.closing",
      value: "CURVED PATH WINS BY 0.18 s",
      applied: true,
    });
    expect(spec.lab!.text.closing).toBe("CURVED PATH WINS BY 0.18 s");
    // Fixed, so it no longer blocks the build.
    expect(quality.status).not.toBe("errors");
  });

  it("B: catches a broken number without touching good ones", () => {
    const plan = race();
    plan.text.closing = "LONGER PATH WINS 2-";
    plan.text.explanation = "0.18s sooner";
    const { spec, quality } = compileBlueprint(plan);
    const broken = quality.findings.find(
      (f) => f.id.startsWith("text.fragment") && f.element === "text.closing",
    )!;
    expect(broken.severity).toBe("error");
    expect(broken.fix).toEqual({
      field: "text.closing",
      value: "LONGER PATH WINS",
      applied: false,
    });
    // Not removed quietly: the words stay until someone chooses the fix.
    expect(spec.lab!.text.closing).toBe("LONGER PATH WINS 2-");
    expect(spec.lab!.text.explanation).toBe("0.18s SOONER");
    expect(quality.status).toBe("errors");
  });

  it("B: catches a line cut off mid-sentence", () => {
    const plan = race();
    plan.text.explanation = "THE SHADOW'S SIZE IS DETERMINED BY THE";
    plan.text.hook = "WHICH PATH WINS?";
    const { quality } = compileBlueprint(plan);
    const cut = quality.findings.filter((f) =>
      f.id.startsWith("text.unfinished"),
    );
    expect(cut.map((f) => [f.element, f.severity])).toEqual([
      ["text.explanation", "error"],
    ]);
    expect(quality.status).toBe("errors");
  });

  it("B: removes a planned duration copied into the words", () => {
    const plan = race();
    plan.text.hook = "WHY DOES A SHADOW GROW? 1.2-2.5 s";
    plan.text.closing = "CURVED PATH WINS BY 0.18 s";
    const { spec, quality } = compileBlueprint(plan);
    expect(spec.lab!.text.hook).toBe("WHY DOES A SHADOW GROW?");
    expect(spec.lab!.text.closing).toBe("CURVED PATH WINS BY 0.18 s");
    const fix = quality.findings.find((f) => f.id === "text.timing:text.hook");
    expect(fix?.fix?.applied).toBe(true);
  });

  it("C: keeps true numbers, and tells time saved from speed", () => {
    const plan = race();
    plan.text.explanation = "0.18s sooner";
    plan.text.closing = "18% less time";
    const ok = compileBlueprint(plan);
    expect(ok.spec.lab!.text.explanation).toBe("0.18s SOONER");
    expect(ok.spec.lab!.text.closing).toBe("18% LESS TIME");
    expect(ok.quality.findings.filter((f) => f.category === "numbers")).toEqual(
      [],
    );
    // 18% is time saved; calling it speed is wrong, and the fix says so.
    plan.text.closing = "18% faster";
    const wrong = compileBlueprint(plan);
    const found = wrong.quality.findings.find(
      (f) => f.id === "numbers.speedVsTime:text.closing",
    )!;
    expect(found.fix?.value).toBe("18% LESS TIME");
    // A wrong number is an error with the measured value offered.
    plan.text.explanation = "0.5s sooner";
    const off = compileBlueprint(plan);
    expect(ids(off.quality)).toContain("numbers.seconds.0.5s:text.explanation");
  });

  it("keeps counts that are right, and flags measured quantities the illusion lacks", () => {
    const plan = defaultBlueprint("muller-lyer", "en");
    plan.text.prediction = "2 equal lines?";
    plan.text.closing = "10% longer looking";
    const { quality } = compileBlueprint(plan);
    expect(ids(quality).some((id) => id.includes("text.prediction"))).toBe(
      false,
    );
    expect(ids(quality)).toContain("numbers.unmeasured.10%:text.closing");
  });

  it("flags a debated explanation stated as fact", () => {
    const plan = defaultBlueprint("muller-lyer", "en");
    plan.text.explanation = "Brain misreads depth";
    expect(ids(compileBlueprint(plan).quality)).toContain(
      "science.debated:text.explanation",
    );
    plan.text.explanation = "One idea: depth cues";
    expect(ids(compileBlueprint(plan).quality)).not.toContain(
      "science.debated:text.explanation",
    );
  });

  it("fixes emoji and stutters, and shows the change", () => {
    const plan = race();
    plan.text.hook = "Which path wins? 🏁 race race";
    const { spec, quality } = compileBlueprint(plan);
    expect(spec.lab!.text.hook).toBe("WHICH PATH WINS? RACE");
    expect(
      quality.findings
        .filter((f) => f.element === "text.hook")
        .every((f) => f.fix?.applied),
    ).toBe(true);
  });
});

describe("quality: picture", () => {
  it("D: finds words over the figures and figures running into each other", () => {
    const plan = defaultBlueprint("muller-lyer", "en");
    plan.parameters = {
      shaft: 0.7,
      fin: 0.35,
      finAngle: 60,
      gap: 0.3,
      longerOnTop: 1,
    };
    plan.text.hook = "Which of these two lines looks longer";
    const tall = compileBlueprint(plan);
    expect(tall.quality.status).toBe("errors");
    expect(
      ids(tall.quality).some(
        (id) =>
          id.startsWith("layout.covers:the hook") ||
          id.startsWith("layout.textOverlap:the hook"),
      ),
    ).toBe(true);
    plan.parameters = {
      shaft: 0.6,
      fin: 0.35,
      finAngle: 60,
      gap: 0.12,
      longerOnTop: 1,
    };
    expect(ids(compileBlueprint(plan).quality)).toContain("layout.figures");
  });

  it("E: lightens a dark colour, keeping its hue, and says so", () => {
    const plan = defaultBlueprint("muller-lyer", "en");
    plan.style = { primary: "#FF7A1F", secondary: "#1A1A4E" };
    const { spec, quality } = compileBlueprint(plan);
    const found = quality.findings.find((f) => f.id === "contrast.secondary")!;
    expect(found.fix?.applied).toBe(true);
    const lighter = spec.lab!.style.secondary;
    expect(Number.parseInt(lighter.slice(5, 7), 16)).toBeGreaterThan(
      Number.parseInt(lighter.slice(1, 3), 16),
    );
  });

  it("F: both ready-made plans build without errors", () => {
    for (const id of ["brachistochrone", "muller-lyer"] as const) {
      const { quality } = compileBlueprint(defaultBlueprint(id, "en"));
      expect(
        quality.findings.filter(
          (f) => f.severity === "error" && !f.fix?.applied,
        ),
      ).toEqual([]);
      expect(quality.checks).toContain(`science:${id}`);
      expect(quality.checks).toContain("layout:representative-frames");
    }
  });
});
