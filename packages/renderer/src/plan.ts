/**
 * Turns an episode into a render plan: whole frames for every scene, sound
 * and caption. Pure and deterministic, so it can be tested exhaustively and
 * two renders of the same episode and settings are the same video.
 *
 * Timing rules:
 *
 *  - A scene lasts its duration, rounded to the nearest frame.
 *  - Narration starts NARRATION_LEAD_SECONDS after the scene begins and is
 *    never cut: if it would run past NARRATION_TAIL_SECONDS before the end,
 *    the scene is lengthened to fit, and a warning says so. A shorter
 *    narration is followed by silence.
 *  - A fade overlaps the start of a scene with the end of the previous one,
 *    for at most FADE_SECONDS and never more than half of either scene. The
 *    lead and tail above are longer than any fade, so two narrations never
 *    overlap.
 *  - A scene's picture is its animation, or its shots back to back: clips
 *    from their trim, stills for their length. Nothing is stretched; a clip's
 *    last frame is held only for a hold the user chose. Time left without a
 *    picture is a gap, and a plan with a gap is not made. Shots that run past
 *    the scene's end are cut there.
 *  - Durations of audio and video are the measured values stored with each
 *    asset. Nothing is estimated from word counts.
 */
import {
  type AnimationSpec,
  type Asset,
  type SceneCoverage,
  type SceneShot,
  computeSceneCoverage,
  effectiveShots,
  type Episode,
  FADE_SECONDS,
  NARRATION_LEAD_SECONDS,
  NARRATION_TAIL_SECONDS,
  type ImageMotion,
  type PlanAudio,
  type PlanCaption,
  type PlanNotice,
  type PlanScene,
  type PlanShot,
  type RenderPlan,
  type RenderSettings,
  type Scene,
} from "@framebop/core";
import { approximateCaptions } from "./captions";

export const MUSIC_FADE_IN_SECONDS = 0.5;
export const MUSIC_FADE_OUT_SECONDS = 1.5;

/** Nearest whole frame, for durations the user chose. */
export function framesOf(seconds: number, fps: number): number {
  return Math.round(seconds * fps);
}

/**
 * Whole frames needed to contain a measured length without cutting it. The
 * small tolerance keeps 2.0 s at 30 fps at 60 frames despite float error.
 */
export function framesToContain(seconds: number, fps: number): number {
  return Math.ceil(seconds * fps - 1e-6);
}

export interface PlanInput {
  episode: Pick<Episode, "musicAssetId" | "musicVolume">;
  scenes: readonly Scene[];
  assets: ReadonlyMap<string, Asset>;
  settings: RenderSettings;
  /** Absolute path of an asset's file. */
  pathOf: (asset: Asset) => string;
  /** Scenes drawn by the 2D animation engine instead of their media. */
  animations?: ReadonlyMap<string, AnimationSpec>;
  /**
   * Mouth openness per frame of a narration file, by its sha256, measured
   * at the plan's frame rate. A missing entry leaves the mouths procedural.
   */
  speech?: ReadonlyMap<string, readonly number[]>;
  /** Each scene's own list of shots; a scene without one uses its slots. */
  shots?: ReadonlyMap<string, readonly SceneShot[]>;
  /** Subtitle text that replaces a scene's narration text. */
  captionTexts?: ReadonlyMap<string, string>;
}

export interface PlanResult {
  plan: RenderPlan | null;
  notices: PlanNotice[];
  /** How much of each scene has a picture, in scene order. */
  coverage: SceneCoverage[];
}

const STILL_MOTIONS: Record<Scene["cameraMotion"], ImageMotion | null> = {
  static: "static",
  push_in: "push_in",
  pull_out: "pull_out",
  pan_left: "pan_left",
  pan_right: "pan_right",
  tilt_up: "tilt_up",
  tilt_down: "tilt_down",
  handheld: "handheld",
  // Moving around a subject needs depth that a single still does not have.
  orbit: null,
};

export function buildRenderPlan(input: PlanInput): PlanResult {
  const { settings } = input;
  const { fps } = settings;
  const notices: PlanNotice[] = [];
  const error = (sceneId: string | null, message: string) =>
    notices.push({ sceneId, severity: "error", message });
  const warn = (sceneId: string | null, message: string) =>
    notices.push({ sceneId, severity: "warning", message });

  if (input.scenes.length === 0) {
    error(null, "The episode has no scenes.");
    return { plan: null, notices, coverage: [] };
  }

  const lead = framesOf(NARRATION_LEAD_SECONDS, fps);
  const tail = framesOf(NARRATION_TAIL_SECONDS, fps);
  const fade = framesOf(FADE_SECONDS, fps);

  const asset = (id: string | null, kind: Asset["kind"]): Asset | null => {
    if (id === null) return null;
    const found = input.assets.get(id);
    return found && found.kind === kind ? found : null;
  };

  const scenes: PlanScene[] = [];
  const audio: PlanAudio[] = [];
  const captions: PlanCaption[] = [];
  const coverage: SceneCoverage[] = [];
  let previous: PlanScene | null = null;

  input.scenes.forEach((scene, index) => {
    const label = `Scene ${index + 1}`;
    let duration = Math.max(1, framesOf(scene.durationSeconds, fps));

    // ------------------------------------------------------------ narration
    const narration = asset(scene.audioAssetId, "audio");
    if (scene.audioAssetId !== null && narration === null) {
      error(
        scene.id,
        `${label}: its narration file is missing from the library.`,
      );
    }
    let narrationFrames = 0;
    if (narration) {
      if (
        narration.durationSeconds === null ||
        narration.durationSeconds <= 0
      ) {
        error(
          scene.id,
          `${label}: the length of its narration is unknown. Play it once in the preview, or import it again with FFmpeg installed.`,
        );
      } else {
        narrationFrames = framesToContain(narration.durationSeconds, fps);
        const needed = lead + narrationFrames + tail;
        if (needed > duration) {
          warn(
            scene.id,
            `${label} is lengthened from ${(duration / fps).toFixed(2)} s to ${(needed / fps).toFixed(2)} s so its narration is not cut.`,
          );
          duration = needed;
        }
      }
    }

    // ---------------------------------------------------------------- shots
    const animation = input.animations?.get(scene.id);
    const overlayText = scene.overlayText.trim();
    const sceneShots = animation
      ? []
      : effectiveShots(scene, input.shots?.get(scene.id) ?? []);
    const covered = computeSceneCoverage({
      sceneId: scene.id,
      durationSeconds: duration / fps,
      narrationSeconds: null,
      animation: animation
        ? { timelineSeconds: animation.durationFrames / animation.fps }
        : null,
      shots: sceneShots,
      clipSeconds: (id) => {
        const clip = asset(id, "video");
        return clip ? clip.durationSeconds : undefined;
      },
      hasStill: (id) => asset(id, "image") !== null,
    });
    const textOnly =
      !animation && sceneShots.length === 0 && overlayText !== "";
    coverage.push({
      ...covered,
      narrationSeconds: narration?.durationSeconds ?? null,
      textOnly,
    });
    for (const problem of covered.problems) {
      const where =
        problem.shot === null ? label : `${label}, shot ${problem.shot + 1}`;
      error(
        scene.id,
        {
          "missing-asset": `${where}: its picture or clip is missing from the library.`,
          "unknown-duration": `${where}: the length of its clip is unknown. Play it once in the preview, or import it again with FFmpeg installed.`,
          "bad-trim": `${where}: its trim leaves nothing of the clip to play.`,
          "two-fill-stills": `${where}: only one still can fill the rest of the scene; give the others a length.`,
        }[problem.code],
      );
    }
    if (!animation && sceneShots.length === 0 && !textOnly) {
      error(
        scene.id,
        `${label} has no image, clip or overlay text, so it would be an empty black screen.`,
      );
    } else if (
      !textOnly &&
      covered.problems.length === 0 &&
      covered.gapSeconds > 0
    ) {
      error(
        scene.id,
        `${label}: ${covered.gapSeconds.toFixed(1)} s of its ${covered.requiredSeconds.toFixed(1)} s have no picture. Add a clip or a still, hold a clip's last frame, or shorten the scene.`,
      );
    }

    const shots: PlanShot[] = [];
    let effects: { file: Asset; frames: number } | null = null;
    if (animation?.lab) {
      // A Lab experiment brings its own sound, timed to its timeline.
      const id = animation.lab.soundAssetId;
      const sound = asset(id, "audio");
      if (id !== null && sound === null) {
        error(
          scene.id,
          `${label}: its sound effects are missing from the library.`,
        );
      } else if (sound && sound.durationSeconds) {
        effects = {
          file: sound,
          frames: Math.min(
            duration,
            framesToContain(sound.durationSeconds, fps),
          ),
        };
      }
      const made = animation.width / animation.height;
      const output = settings.width / settings.height;
      if (Math.abs(made - output) > 0.01) {
        warn(
          scene.id,
          `${label}: the Lab experiment is made for ${animation.width} × ${animation.height}; at ${settings.width} × ${settings.height} it is shown smaller, with bars. Choose ${animation.width} × ${animation.height} in the render settings.`,
        );
      }
    }
    if (animation) {
      // The mouth follows the narration from the moment it starts.
      const voice = narration ? input.speech?.get(narration.sha256) : undefined;
      const mouth = voice
        ? Array.from({ length: duration }, (_, f) =>
            f >= lead && f < lead + narrationFrames
              ? (voice[f - lead] ?? 0)
              : 0,
          )
        : [];
      const images: Record<string, { src: string; sha256: string }> = {};
      for (const [key, image] of Object.entries(animation.images)) {
        const file = image.assetId ? asset(image.assetId, "image") : null;
        if (file) {
          images[key] = { src: input.pathOf(file), sha256: file.sha256 };
        } else {
          error(
            scene.id,
            `${label}: the animation's picture "${image.name}" is missing from the library.`,
          );
        }
      }
      if (animation.renderer === "pixi") {
        // PixiJS draws pictures only; vector props and characters need SVG.
        const vector = animation.layers.some((layer) =>
          layer.items.some(
            (item) => animation.assets[item.asset]?.kind !== "image",
          ),
        );
        if (vector || animation.characters.some((c) => !c.sprites)) {
          error(
            scene.id,
            `${label}: the PixiJS renderer draws only pictures; this animation has vector props or characters. Use the SVG renderer for it.`,
          );
        }
      }
      shots.push({
        from: 0,
        durationInFrames: duration,
        visual: { kind: "animation", spec: animation, mouth, images },
      });
    } else if (!textOnly && covered.problems.length === 0) {
      let motion = STILL_MOTIONS[scene.cameraMotion];
      if (motion === null && sceneShots.some((shot) => shot.kind === "still")) {
        warn(
          scene.id,
          `${label}: "${scene.cameraMotion}" needs a video clip. The still is shown without movement.`,
        );
      }
      motion ??= "static";
      // Seconds to whole frames, end to end, so the shots meet exactly.
      let elapsed = 0;
      for (const segment of covered.segments) {
        const shot = segment.shot === null ? null : sceneShots[segment.shot];
        const start = Math.min(duration, Math.round(elapsed * fps));
        elapsed += segment.seconds;
        const end = Math.min(duration, Math.round(elapsed * fps));
        if (!shot || end <= start) continue;
        if (segment.kind === "hold") {
          // The chosen hold extends the clip shot it belongs to.
          const last = shots[shots.length - 1];
          if (last?.visual.kind === "video") {
            last.durationInFrames = end - last.from;
          }
          continue;
        }
        const file = asset(
          segment.assetId,
          shot.kind === "clip" ? "video" : "image",
        );
        if (!file) continue;
        shots.push({
          from: start,
          durationInFrames: end - start,
          visual:
            shot.kind === "clip"
              ? {
                  kind: "video",
                  src: input.pathOf(file),
                  sha256: file.sha256,
                  startFrame: Math.round(shot.trimStart * fps),
                  playFrames: end - start,
                }
              : {
                  kind: "image",
                  src: input.pathOf(file),
                  sha256: file.sha256,
                  motion,
                },
        });
      }
    }

    // ------------------------------------------------------------ placement
    // The first scene has nothing to fade from, so it always starts cleanly.
    let fadeInFrames = 0;
    if (previous && scene.transition === "fade") {
      fadeInFrames = Math.min(
        fade,
        Math.floor(previous.durationInFrames / 2),
        Math.floor(duration / 2),
      );
    }
    const from = previous
      ? previous.from + previous.durationInFrames - fadeInFrames
      : 0;

    const planned: PlanScene = {
      sceneId: scene.id,
      index,
      from,
      durationInFrames: duration,
      fadeInFrames,
      shots,
      overlay: overlayText
        ? { text: overlayText, position: scene.overlayPosition }
        : null,
    };
    scenes.push(planned);
    previous = planned;

    if (narration && narrationFrames > 0) {
      audio.push({
        kind: "narration",
        sceneId: scene.id,
        src: input.pathOf(narration),
        sha256: narration.sha256,
        from: from + lead,
        durationInFrames: narrationFrames,
        volume: 1,
        loop: false,
        fadeInFrames: 0,
        fadeOutFrames: 0,
      });
    }

    if (effects) {
      audio.push({
        kind: "effects",
        sceneId: scene.id,
        src: input.pathOf(effects.file),
        sha256: effects.file.sha256,
        from,
        durationInFrames: effects.frames,
        volume: 1,
        loop: false,
        fadeInFrames: 0,
        fadeOutFrames: 0,
      });
    }

    const captionText =
      input.captionTexts?.get(scene.id) ?? scene.narrationText;
    if (settings.captions === "approximate" && captionText.trim()) {
      // Timed across the narration when there is one, else across the scene.
      const start = from + lead;
      const length =
        narrationFrames > 0 ? narrationFrames : duration - lead - tail;
      captions.push(
        ...approximateCaptions(captionText, start, Math.max(1, length)),
      );
    }
  });

  const last = scenes[scenes.length - 1];
  const durationInFrames = last ? last.from + last.durationInFrames : 0;

  const music = asset(input.episode.musicAssetId, "audio");
  if (input.episode.musicAssetId !== null && music === null) {
    error(null, "The episode's background music is missing from the library.");
  } else if (music && input.episode.musicVolume > 0) {
    audio.push({
      kind: "music",
      sceneId: null,
      src: input.pathOf(music),
      sha256: music.sha256,
      from: 0,
      durationInFrames,
      volume: input.episode.musicVolume,
      loop: true,
      fadeInFrames: Math.min(
        framesOf(MUSIC_FADE_IN_SECONDS, fps),
        Math.floor(durationInFrames / 4),
      ),
      fadeOutFrames: Math.min(
        framesOf(MUSIC_FADE_OUT_SECONDS, fps),
        Math.floor(durationInFrames / 4),
      ),
    });
  }

  if (notices.some((notice) => notice.severity === "error")) {
    return { plan: null, notices, coverage };
  }
  return {
    coverage,
    plan: {
      version: 2,
      width: settings.width,
      height: settings.height,
      fps,
      durationInFrames,
      scenes,
      audio,
      captions,
      captionsApproximate: settings.captions === "approximate",
    },
    notices,
  };
}

/**
 * Throws if two narrations overlap or anything lies outside the video. The
 * planner's rules make both impossible; this is the check that they hold.
 */
export function assertPlanConsistent(plan: RenderPlan): void {
  const narration = plan.audio
    .filter((clip) => clip.kind === "narration")
    .sort((a, b) => a.from - b.from);
  for (let i = 1; i < narration.length; i += 1) {
    const before = narration[i - 1]!;
    const after = narration[i]!;
    if (before.from + before.durationInFrames > after.from) {
      throw new Error(
        `Narrations of two scenes overlap at frame ${after.from}.`,
      );
    }
  }
  for (const clip of plan.audio) {
    if (clip.from + clip.durationInFrames > plan.durationInFrames) {
      throw new Error("An audio clip runs past the end of the video.");
    }
  }
  for (const scene of plan.scenes) {
    if (scene.from + scene.durationInFrames > plan.durationInFrames) {
      throw new Error("A scene runs past the end of the video.");
    }
  }
}
