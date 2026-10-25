/**
 * A scene graph's sound, from its cues: hits, notes, chords, rises,
 * whooshes, ticks, and tones that follow a solver's value (a shadow's size
 * heard as pitch). Deterministic, like every Lab soundtrack.
 */
import type { SceneLab } from "@framebop/core";
import { Mixer, random } from "../cinema/sound";
import { frameOf, numberAt, sceneContext } from "./evaluate";

export function sceneSound(lab: SceneLab): Float32Array {
  const ctx = sceneContext(lab);
  const { fps } = lab.graph;
  const total = ctx.timeline.duration / fps;
  const mix = new Mixer(total);
  const out = mix.out;
  const rate = mix.rate;
  // A low bed, level across the loop's seam.
  for (let i = 0; i < out.length; i += 1) {
    const t = i / rate;
    const swell = 0.8 + 0.2 * Math.sin((2 * Math.PI * t) / total);
    out[i]! +=
      swell *
      (0.04 * Math.sin(2 * Math.PI * 55 * t) +
        0.024 * Math.sin(2 * Math.PI * 82.41 * t + 1));
  }
  const sec = (frame: number) => frame / fps;
  for (const cue of lab.graph.cues) {
    const at = sec(frameOf(ctx, cue.at));
    const until = cue.until
      ? sec(frameOf(ctx, cue.until))
      : at + (cue.value > 0 && cue.cue === "riser" ? cue.value : 1);
    switch (cue.cue) {
      case "impact":
        mix.impact(at, cue.amp);
        break;
      case "pluck":
        mix.pluck(at, cue.value || 523.25, cue.amp);
        break;
      case "chord": {
        const root = cue.value || 261.6;
        mix.chord(
          at,
          [root, root * 1.26, root * 1.5, root * 2],
          cue.amp,
          1.6,
          0.6,
        );
        break;
      }
      case "riser":
        mix.riser(at, Math.max(0.2, until - at), cue.amp);
        break;
      case "whoosh":
        mix.noise(at, 0.7, cue.amp, Math.round(at * 101), {
          cutoff: 2600,
          cutoffTo: 300,
          env: (u) => Math.sin(Math.PI * u) ** 2,
        });
        break;
      case "tick":
        mix.tone(at, 0.06, 1500, cue.amp, { decay: 0.02 });
        break;
      case "follow": {
        if (!cue.ref) break;
        // A soft tone, an octave over [low, high] of the followed value.
        const from = Math.round(at * rate);
        const to = Math.min(out.length, Math.round(until * rate));
        const base = cue.value || 196;
        const noise = random(from);
        let phase = 0;
        let pitch = base;
        for (let i = from; i < to; i += 1) {
          if ((i - from) % 48 === 0) {
            const value = numberAt(
              ctx,
              { ref: cue.ref, times: 1, plus: 0 },
              (i / rate) * fps,
            );
            const u = Math.max(
              0,
              Math.min(1, (value - cue.low) / (cue.high - cue.low || 1)),
            );
            pitch = base * 2 ** u;
          }
          const edge = Math.min(
            1,
            (i - from) / (rate * 0.2),
            (to - i) / (rate * 0.2),
          );
          phase += (2 * Math.PI * pitch) / rate;
          out[i]! +=
            edge *
            cue.amp *
            (Math.sin(phase) +
              0.3 * Math.sin(2 * phase) +
              0.05 * (noise() * 2 - 1));
        }
        break;
      }
    }
  }
  return mix.finish();
}
