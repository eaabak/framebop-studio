/**
 * A Lab experiment's sound design, synthesised from its timeline: the same
 * spec always gives the same samples. The slides are heard from the
 * simulation itself, louder and higher as each sphere speeds up.
 */
import type {
  AnimationSpec,
  BrachistochroneLab,
  MullerLyerLab,
} from "@framebop/core";
import { stateAt } from "./physics";
import { MARK_STEP, SNAPSHOTS, direct } from "./brachistochrone/director";
import { remapTime } from "../cinema/remap";
import { sceneSound } from "../scene/sound";
import { Mixer, random } from "../cinema/sound";

export { wavFile } from "../cinema/sound";

/** Mono samples, -1..1, as long as the spec's timeline. */
export function labSoundtrack(spec: AnimationSpec): Float32Array {
  const lab = spec.lab;
  if (!lab) throw new Error("This animation is not a Lab experiment.");
  switch (lab.kind) {
    case "brachistochrone":
      return brachistochroneSound(lab, spec.fps, spec.durationFrames, {
        width: spec.width,
        height: spec.height,
      });
    case "muller-lyer":
      return mullerLyerSound(lab, spec.fps, spec.durationFrames);
    case "scene":
      return sceneSound(lab);
  }
}

/**
 * The illusion's sound: a cue with the question, a note per figure, ticks
 * while the guides drop, a match when the shafts meet, and a warm close.
 */
function mullerLyerSound(
  lab: MullerLyerLab,
  fps: number,
  frames: number,
): Float32Array {
  const { beats } = lab;
  const sec = (frame: number) => frame / fps;
  const total = sec(frames);
  const mix = new Mixer(total);
  const out = mix.out;
  const rate = mix.rate;
  for (let i = 0; i < out.length; i += 1) {
    const t = i / rate;
    const swell = 0.8 + 0.2 * Math.sin((2 * Math.PI * t) / total);
    out[i]! +=
      swell *
      (0.04 * Math.sin(2 * Math.PI * 65.4 * t) +
        0.024 * Math.sin(2 * Math.PI * 98 * t + 1) +
        0.012 * Math.sin(2 * Math.PI * 130.8 * t + 2));
  }
  mix.impact(0.02, 0.32);
  mix.chord(0.02, [261.6, 392, 523.25], 0.06, 1.2, 0.5);
  // Each figure's note as the prediction lights it.
  mix.pluck(sec(beats.prediction + 6), 523.25, 0.11);
  mix.pluck(sec(beats.prediction + 16), 659.25, 0.11);
  mix.riser(
    sec(beats.prediction + 20),
    sec(beats.experiment - beats.prediction - 20),
    0.05,
  );
  // The guides dropping, then the click as they reach the lower shaft.
  for (let k = 0; k < 8; k += 1) {
    mix.tone(sec(beats.experiment + 6 + k * 3), 0.05, 1500 + k * 60, 0.05, {
      decay: 0.015,
    });
  }
  mix.kick(sec(beats.experiment + 30), 0.22);
  mix.tone(sec(beats.experiment + 30), 0.3, 1760, 0.08, { decay: 0.08 });
  // The reveal: fins swept away, the shafts laid together, a match.
  mix.noise(sec(beats.reveal), 0.5, 0.07, 21, {
    cutoff: 5000,
    cutoffTo: 600,
    env: (u) => Math.sin(Math.PI * u) ** 2,
  });
  mix.impact(sec(beats.reveal + 24), 0.42);
  mix.chord(
    sec(beats.reveal + 24),
    [523.25, 659.25, 783.99, 1046.5],
    0.11,
    1.6,
    0.55,
  );
  // The explanation: a note as each box is drawn round a whole figure.
  mix.pluck(sec(beats.explanation + 10), 392, 0.08);
  mix.pluck(sec(beats.explanation + 20), 493.9, 0.08);
  // The close.
  mix.chord(sec(beats.closing + 4), [220, 277.2, 329.6, 440], 0.08, 2.2, 0.9);
  mix.kick(sec(beats.closing + 4), 0.2);
  return mix.finish();
}

/**
 * Which Path Wins?: a clear opening cue, the slides heard from the
 * simulation, a light pulse that tightens as the spheres speed up, a bright
 * chord for the winner, a distinct accent for the reveal, soft ticks as the
 * explanation's marks drop, and a warm close that settles back to the start.
 */
function brachistochroneSound(
  lab: BrachistochroneLab,
  fps: number,
  frames: number,
  size: { width: number; height: number },
): Float32Array {
  const d = direct(lab, fps, frames, size);
  const { beats, releaseFrame: go } = lab;
  const sec = (frame: number) => frame / fps;
  const total = sec(frames);
  const mix = new Mixer(total);
  const out = mix.out;
  const rate = mix.rate;
  const top = Math.sqrt(2 * lab.gravity * lab.drop);
  const winner = d.lanes[d.winner].trajectory;
  const loser = d.lanes[1 - d.winner]!.trajectory;
  const won = sec(d.arrivals[d.winner]);
  const lost = sec(d.arrivals[1 - d.winner]!);

  // A low pad under everything, at the same level across the loop's seam.
  for (let i = 0; i < out.length; i += 1) {
    const t = i / rate;
    const swell = 0.8 + 0.2 * Math.sin((2 * Math.PI * t) / total);
    out[i]! +=
      swell *
      (0.04 * Math.sin(2 * Math.PI * 55 * t) +
        0.026 * Math.sin(2 * Math.PI * 82.41 * t + 1) +
        0.014 * Math.sin(2 * Math.PI * 110 * t + 2));
  }

  // Opening cue with the title, then the gate's release.
  mix.impact(0.02, 0.34);
  mix.chord(0.02, [220, 329.6, 440], 0.06, 1.2, 0.5);
  mix.riser(sec(8), sec(go - 8), 0.06);
  mix.kick(sec(go), 0.28);
  mix.noise(sec(go), 0.05, 0.22, 5, { cutoff: 2200 });
  mix.tone(sec(go), 0.3, 1568, 0.07, { decay: 0.09 });

  // The race: a soft hat whose beat tightens and brightens with the speed.
  let next = go + 9;
  while (next < d.arrivals[d.winner]) {
    const t = (next - go) / fps / lab.slowMotion;
    const v = Math.max(stateAt(winner, t).speed, stateAt(loser, t).speed) / top;
    mix.hat(sec(next), 0.025 + 0.05 * v);
    next += 9 - 4 * v;
  }

  // The slides, from the simulation through the edit.
  d.lanes.forEach((lane, index) => {
    const noise = random(10 + index);
    let low = 0;
    let phase = 0;
    let speed = 0;
    const loud = 1;
    for (let i = 0; i < out.length; i += 1) {
      if (i % 48 === 0) {
        const { time, segment } = remapTime(d.cut, (i / rate) * fps);
        const s = stateAt(lane.trajectory, time);
        const kind = segment?.kind;
        const moving = (kind === "run" || kind === "replay") && !s.arrived;
        // The replay is quieter than the live race.
        const level = kind === "replay" ? 0.5 : loud;
        speed = moving ? (s.speed / top) * level : speed * 0.9;
      }
      if (speed < 0.002) continue;
      const k = 1 - Math.exp((-2 * Math.PI * (500 + 2600 * speed)) / rate);
      low += (noise() * 2 - 1 - low) * k;
      phase +=
        (2 * Math.PI * (index === 1 ? 150 : 120) * (1 + speed * 1.4)) / rate;
      out[i]! += speed * (0.1 * low + 0.04 * Math.sin(phase));
    }
  });

  // The finish: a bright chord for the winner, a muted note for the other.
  mix.kick(won, 0.32);
  mix.chord(won, [1046.5, 1318.5, 1568], 0.12, 1.4, 0.45);
  mix.tone(lost, 0.6, 392, 0.09, { decay: 0.16 });

  // The reveal: a low hit and a rising shimmer, unlike the finish.
  const reveal = sec(beats.reveal);
  mix.impact(reveal, 0.42);
  mix.chord(reveal, [261.6, 392, 523.25], 0.08, 1.6, 0.6);
  for (let k = 0; k < 4; k += 1) {
    mix.tone(reveal + 0.08 + k * 0.07, 0.3, 1046.5 * 1.122 ** (k * 2), 0.03, {
      decay: 0.08,
    });
  }

  // The explanation: the camera's move, and a tick per pair of marks.
  mix.noise(sec(beats.explanation - 2), 0.7, 0.05, 11, {
    cutoff: 2600,
    cutoffTo: 300,
    env: (u) => Math.sin(Math.PI * u) ** 2,
  });
  const notes = [
    523.25, 587.33, 659.25, 783.99, 880, 987.77, 1046.5, 1174.7, 1318.5,
  ];
  for (let k = 1; k <= SNAPSHOTS; k += 1) {
    const at = d.replay.from + k * MARK_STEP * lab.replaySlowMotion * fps;
    if (at < d.replay.to) mix.pluck(sec(at), notes[k - 1]!, 0.06);
  }

  // The payoff: a warm chord with the line, settling into the opening.
  mix.chord(sec(beats.closing + 4), [220, 277.2, 329.6, 440], 0.08, 2.4, 1);
  mix.kick(sec(beats.closing + 4), 0.2);
  for (const jump of d.jumps.slice(1)) {
    mix.tone(sec(jump), 0.12, 700, 0.06, { decay: 0.04, glide: 0.5 });
  }

  return mix.finish();
}
