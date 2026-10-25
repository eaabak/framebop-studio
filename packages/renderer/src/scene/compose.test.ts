import {
  ART_STYLES,
  DIRECTION_KEYS,
  DIRECTION_OPTIONS,
  resolveDirection,
} from "@framebop/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { compileBlueprint, defaultBlueprint } from "../lab/capabilities";
import { composeScene } from "./compose";
import { frameOf, perspective, sceneContext, solversAt } from "./evaluate";
import { shadowStage } from "./library/shadow";
import { SceneView } from "./SceneView";

type Direction = ReturnType<typeof defaultBlueprint>["direction"];

const build = (
  direction: Direction,
  edit?: (p: ReturnType<typeof defaultBlueprint>) => void,
) => {
  const plan = defaultBlueprint("point-light-shadow", "en");
  plan.direction = direction;
  edit?.(plan);
  return compileBlueprint(plan);
};
const labOf = (spec: ReturnType<typeof build>["spec"]) => {
  const lab = spec.lab!;
  if (lab.kind !== "scene") throw new Error("Not a scene.");
  return lab;
};

describe("the visual scene composer", () => {
  it("chooses the composition from the style, or as asked", () => {
    expect(labOf(build({ style: "educational" }).spec).graph.nodes[0]!.id).toBe(
      "backdrop",
    );
    expect(labOf(build({ style: "cinematic" }).spec).graph.nodes[0]!.id).toBe(
      "room",
    );
    const asked = build({ style: "cinematic", composition: "diagram" });
    expect(labOf(asked.spec).graph.nodes[0]!.id).toMatch(/^backdrop/);
    // A composition the capability lacks is reported, not invented.
    const missing = build({ style: "cinematic", composition: "orbit" });
    expect(missing.notices.some((n) => n.message.includes('no "orbit"'))).toBe(
      true,
    );
    expect(labOf(missing.spec).graph.nodes[0]!.id).toBe("room");
  });

  it("turns each direction into the scene's data", () => {
    const doc = shadowStage();
    const base = resolveDirection({ style: "cinematic" }, ["stage"]).direction;
    const calm = composeScene(doc, { ...base, motion: "calm" });
    const bold = composeScene(doc, { ...base, motion: "bold" });
    const range = (g: typeof calm) => {
      const cam = g.solvers.find((s) => s.kind === "perspective")!;
      if (
        cam.kind !== "perspective" ||
        typeof cam.camera.z === "number" ||
        !("keys" in cam.camera.z)
      )
        throw new Error("No dolly.");
      const zs = cam.camera.z.keys.map((k) => k.value as number);
      return Math.max(...zs) - Math.min(...zs);
    };
    expect(range(bold)).toBeGreaterThan(range(calm) * 3);
    const ids = (g: typeof calm) => g.nodes.map((n) => n.id);
    expect(ids(composeScene(doc, { ...base, reveal: "dramatic" }))).toContain(
      "flare",
    );
    expect(ids(composeScene(doc, { ...base, reveal: "simple" }))).not.toContain(
      "flare",
    );
    expect(ids(composeScene(doc, { ...base, depth: "deep" }))).toContain(
      "nearCrate",
    );
    expect(ids(composeScene(doc, { ...base, depth: "flat" }))).not.toContain(
      "haze",
    );
    const lit = composeScene(doc, { ...base, lighting: "spotlight" });
    expect(lit.nodes.find((n) => n.type === "lighting")).toMatchObject({
      preset: "spotlight",
    });
    expect(lit.typography).toEqual({ style: "cinematic", transition: "fade" });
  });

  it("builds every style, composition and option without a problem", () => {
    let built = 0;
    for (const style of ART_STYLES)
      for (const composition of ["diagram", "stage"])
        for (const key of DIRECTION_KEYS)
          for (const value of DIRECTION_OPTIONS[key]) {
            const { quality } = build({ style, composition, [key]: value });
            const open = quality.findings.filter(
              (f) =>
                !f.fix?.applied &&
                (f.severity === "error" ||
                  (f.severity === "warning" &&
                    !f.id.startsWith("layout.near"))),
            );
            expect([
              style,
              composition,
              key,
              value,
              open.map((f) => f.id),
            ]).toEqual([style, composition, key, value, []]);
            built += 1;
          }
    expect(built).toBe(240);
  });
});

describe("the perspective camera", () => {
  it("places nearer points larger, and keeps lines straight", () => {
    const at = (u: number, v: number, z: number) =>
      perspective({
        camU: 0,
        camV: 0,
        camZ: -700,
        focal: 1580,
        cx: 540,
        cy: 1090,
        u,
        v,
        z,
      });
    expect(at(0, 0, 880).s).toBeCloseTo(1, 9);
    expect(at(0, 0, 300).s).toBeGreaterThan(at(0, 0, 740).s);
    // Three points on one line in space stay on one line in the picture.
    const [a, b, c] = [at(-150, 196, 170), at(-40, 100, 400), at(70, 4, 630)];
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    expect(Math.abs(cross)).toBeLessThan(1e-6);
    expect(at(0, 0, -800).valid).toBe(0);
  });
});

describe("the staged shadow", () => {
  const stage = labOf(build({ style: "cinematic" }).spec);
  const diagram = labOf(build({ style: "educational" }).spec);

  it("shows the same science as the diagram", () => {
    const a = sceneContext(stage);
    const b = sceneContext(diagram);
    for (const frame of [0, 120, 240, 330, 450])
      expect(solversAt(a, frame).shadow!.ratio).toBeCloseTo(
        solversAt(b, frame).shadow!.ratio!,
        9,
      );
  });

  it("puts its rays through the subject, in the picture too", () => {
    const ctx = sceneContext(stage);
    const frame = frameOf(ctx, { beat: "explanation", offset: 40 });
    const out = solversAt(ctx, frame);
    const s = out.shadow!;
    const cam = out.cam!;
    // The subject's top: the same depth and sideways place as its feet, its
    // height higher, at the scale the camera gives that depth.
    // Collinear: light, the subject's top and the shadow's top lie on one
    // ray in space, so on one line in the picture.
    const heroTopX = cam.heroX!;
    const heroTopY = cam.heroY! - s.objHeight! * cam.heroS!;
    const cross =
      (heroTopX - cam.bulbX!) * (cam.shadeTopY! - cam.bulbY!) -
      (heroTopY - cam.bulbY!) * (cam.shadeTopX! - cam.bulbX!);
    const length = Math.hypot(
      cam.shadeTopX! - cam.bulbX!,
      cam.shadeTopY! - cam.bulbY!,
    );
    expect(Math.abs(cross) / length).toBeLessThan(0.5);
    // The floor shadow ends where the wall shadow starts, by the same ratio.
    expect(s.shadowLeft! - s.lightU!).toBeCloseTo(
      (s.objLeft! - s.lightU!) * s.ratio!,
      9,
    );
    expect(s.shadowWidth!).toBeCloseTo(s.objHeight! * 0.78 * s.ratio!, 9);
  });

  it("draws two different productions, each the same every time", () => {
    const draw = (lab: typeof stage) =>
      renderToStaticMarkup(createElement(SceneView, { lab, frame: 260 }));
    const b = draw(stage);
    expect(draw(stage)).toBe(b);
    expect(b).toContain("feFlood"); // the wall shadow is the mascot's outline
    expect(b).toContain("letter-spacing"); // cinematic type
    const a = draw(diagram);
    expect(a).not.toContain("feFlood");
    expect(a).not.toBe(b);
  });

  it("tells a fixed-look animation that art direction does not apply", () => {
    const plan = defaultBlueprint("brachistochrone", "en");
    plan.direction = { style: "cinematic" };
    const { notices } = compileBlueprint(plan);
    expect(notices.some((n) => n.message.includes("one fixed look"))).toBe(
      true,
    );
  });
});
