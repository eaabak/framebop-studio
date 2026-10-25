import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { QualityRulesSchema } from "@framebop/core";
import { describe, expect, it } from "vitest";
import { compileBlueprint, defaultBlueprint } from "../lab/capabilities";
import {
  frameOf,
  pointShadow,
  sceneContext,
  solversAt,
  trackAt,
} from "./evaluate";
import { reviewSceneLayout } from "./quality";
import { SceneView } from "./SceneView";

const build = (edit?: (plan: ReturnType<typeof defaultBlueprint>) => void) => {
  const plan = defaultBlueprint("point-light-shadow", "en");
  edit?.(plan);
  return compileBlueprint(plan);
};
const labOf = (spec: ReturnType<typeof build>["spec"]) => {
  const lab = spec.lab!;
  if (lab.kind !== "scene") throw new Error("Not a scene.");
  return lab;
};

describe("point-light shadow", () => {
  it("follows similar triangles exactly", () => {
    for (const objectX of [260, 400, 700]) {
      const s = pointShadow({
        lightX: 170,
        lightY: 960,
        objectX,
        objectY: 960,
        height: 140,
        screenX: 880,
      });
      // Shadow / object = D / d.
      expect(s.shadowHeight / s.objHeight).toBeCloseTo(
        (880 - 170) / (objectX - 170),
        9,
      );
      // The light, the object's top edge and the shadow's top are on one ray.
      const cross =
        (objectX - 170) * (s.shadowTop - 960) - (880 - 170) * (s.objTop - 960);
      expect(Math.abs(cross)).toBeLessThan(1e-6);
      expect(s.valid).toBe(1);
    }
    expect(
      pointShadow({
        lightX: 170,
        lightY: 960,
        objectX: 150,
        objectY: 960,
        height: 140,
        screenX: 880,
      }).valid,
    ).toBe(0);
  });

  it("is evaluated from the frame alone", () => {
    const lab = labOf(build().spec);
    const a = sceneContext(lab);
    const b = sceneContext(lab);
    const late = solversAt(a, 300).shadow!;
    solversAt(b, 10);
    expect(solversAt(b, 300).shadow).toEqual(late);
  });

  it("grows the shadow as the object nears the light", () => {
    const lab = labOf(build().spec);
    const ctx = sceneContext(lab);
    const start = solversAt(
      ctx,
      frameOf(ctx, { beat: "experiment", offset: 0 }),
    ).shadow!;
    const near = solversAt(
      ctx,
      frameOf(ctx, { beat: "reveal", offset: 0 }),
    ).shadow!;
    expect(near.objX).toBeLessThan(start.objX!);
    expect(near.shadowHeight).toBeGreaterThan(start.shadowHeight! * 2);
  });
});

describe("a scene built from its plan", () => {
  it("builds the default plan with no errors, through the scene graph", () => {
    const { spec, quality } = build();
    expect(spec.lab?.kind).toBe("scene");
    expect(
      quality.findings.filter((f) => f.severity === "error" && !f.fix?.applied),
    ).toEqual([]);
    expect(quality.checks).toContain("science:point-light-shadow");
  });

  it("changes the video when movement, timing or style change", () => {
    const frame = 240;
    const draw = (spec: ReturnType<typeof build>["spec"]) =>
      renderToStaticMarkup(
        createElement(SceneView, { lab: labOf(spec), frame }),
      );
    const base = draw(build().spec);
    expect(base).toContain("<polygon");
    expect(draw(build().spec)).toBe(base);
    const moved = build((p) => (p.parameters.endX = 420));
    const timed = build(
      (p) =>
        (p.scenes = p.scenes.map((s) =>
          s.beat === "experiment" ? { ...s, seconds: 8 } : s,
        )),
    );
    const styled = build(
      (p) => (p.style = { primary: "#FFB020", secondary: "#A06BFF" }),
    );
    for (const variant of [moved, timed, styled])
      expect(draw(variant.spec)).not.toBe(base);
    expect(draw(styled.spec)).toContain("#A06BFF");
    expect(timed.spec.durationFrames).toBe(build().spec.durationFrames + 60);
  });

  it("keeps long planned headlines clear of the scene", () => {
    // Texts a local model wrote, which once covered the screen.
    const { quality } = build((p) => {
      p.text.hook = "WHY DOES A SHADOW GROW WHEN AN OBJECT IS";
      p.text.explanation = "SHADOW SIZE DEPENDS ON DISTANCE";
      p.text.closing = "SHADOW GROWS WHEN OBJECT APPROACHES";
    });
    expect(
      quality.findings.filter(
        (f) => f.category === "layout" && f.severity === "error",
      ),
    ).toEqual([]);
  });

  it("keeps beats no longer than what moves in them", () => {
    // The longest beats a local model planned; its reveal and closing held
    // still, and the video ran 31 s.
    const planned = {
      hook: 4,
      experiment: 12,
      reveal: 3.5,
      explanation: 8,
      closing: 5,
    };
    const { spec, quality, notices } = build(
      (p) =>
        (p.scenes = p.scenes.map((s) => ({
          ...s,
          seconds: planned[s.beat as keyof typeof planned] ?? s.seconds,
        }))),
    );
    const lab = labOf(spec);
    expect(lab.graph.timeline.find((t) => t.beat === "reveal")!.seconds).toBe(
      2.6,
    );
    expect(notices.some((n) => n.message.includes("reveal"))).toBe(true);
    expect(spec.durationFrames / 30).toBeLessThanOrEqual(23);
    expect(
      quality.findings.filter((f) => f.id.startsWith("timing.still")),
    ).toEqual([]);
    // The same plan, unclamped, is caught before the render.
    const held = structuredClone(spec);
    const heldLab = labOf(held);
    heldLab.graph.timeline = heldLab.graph.timeline.map((t) =>
      t.beat === "reveal" ? { ...t, seconds: 3.5 } : t,
    );
    expect(
      reviewSceneLayout(held, QualityRulesSchema.parse({})).some(
        (f) => f.id === "timing.still:reveal",
      ),
    ).toBe(true);
  });

  it("refuses labels that name the wrong things", () => {
    // A local model's labels: the object called LIGHT, the shadow OBJECT.
    const { quality } = build((p) => (p.text.labels = ["LIGHT", "OBJECT"]));
    const roles = quality.findings.filter((f) =>
      f.id.startsWith("labels.role"),
    );
    expect(roles.map((f) => [f.element, f.severity])).toEqual([
      ["text.labels.0", "error"],
      ["text.labels.1", "error"],
    ]);
    expect(roles[1]!.fix).toEqual({
      field: "text.labels.1",
      value: "SHADOW",
      applied: false,
    });
    const fine = build((p) => (p.text.labels = ["BALL", "ITS SHADOW"]));
    expect(
      fine.quality.findings.some((f) => f.id.startsWith("labels.role")),
    ).toBe(false);
  });

  it("holds words placed under a headline still while it is shown", () => {
    const lab = labOf(build().spec);
    const ctx = sceneContext(lab);
    const rule = lab.graph.nodes.find((n) => n.id === "rule")!;
    if (rule.type !== "label" || !rule.shown) throw new Error("No rule label.");
    const from = frameOf(ctx, rule.shown.from);
    const to = frameOf(ctx, rule.shown.to);
    const ys = Array.from({ length: to - from + 1 }, (_, i) =>
      trackAt(ctx, rule.y, from + i),
    );
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1);
  });

  it("refuses an object placed behind the light", () => {
    const { quality } = build((p) => {
      p.parameters.endX = 240;
      p.parameters.lightX = 300;
    });
    expect(
      quality.findings.some(
        (f) => f.id === "science.geometry:shadow" && f.severity === "error",
      ),
    ).toBe(true);
  });

  it("checks size claims against the computed shadow", () => {
    const wrong = build((p) => (p.text.closing = "20× bigger shadow"));
    expect(
      wrong.quality.findings.some(
        (f) => f.id.startsWith("numbers.ratio") && f.severity === "error",
      ),
    ).toBe(true);
    const right = build((p) => (p.text.closing = "3× bigger shadow"));
    expect(
      right.quality.findings.some((f) => f.id.startsWith("numbers.ratio")),
    ).toBe(false);
  });
});
