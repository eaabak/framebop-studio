import { createHash } from "node:crypto";
import type { RenderPlan } from "@framebop/core";

/**
 * A hash of what a plan would render: its timing, settings and the content
 * of its files, but not where those files are. Two plans with the same
 * identity produce the same video.
 */
export function planIdentity(plan: RenderPlan): string {
  const anonymous = {
    ...plan,
    scenes: plan.scenes.map((scene) => ({
      ...scene,
      shots: scene.shots.map((shot) => ({
        ...shot,
        visual:
          shot.visual.kind === "none"
            ? shot.visual
            : shot.visual.kind === "animation"
              ? {
                  ...shot.visual,
                  images: Object.fromEntries(
                    Object.entries(shot.visual.images).map(([key, file]) => [
                      key,
                      { ...file, src: file.sha256 },
                    ]),
                  ),
                }
              : { ...shot.visual, src: shot.visual.sha256 },
      })),
    })),
    audio: plan.audio.map((clip) => ({ ...clip, src: clip.sha256 })),
  };
  return createHash("sha256").update(JSON.stringify(anonymous)).digest("hex");
}
