/**
 * Sound design by synthesis: tones, filtered noise and a gentle master, all
 * seeded, so the same timeline always gives the same samples.
 */

export const SAMPLE_RATE = 48_000;

/** A 16-bit PCM mono WAV file of the samples. */
export function wavFile(samples: Float32Array, rate = SAMPLE_RATE): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) =>
    [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const v = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, Math.round(v * 32767), true);
  }
  return bytes;
}

/** A seeded generator, so the noise is the same every time. */
export function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Mixer {
  readonly out: Float32Array;
  constructor(
    seconds: number,
    readonly rate = SAMPLE_RATE,
  ) {
    this.out = new Float32Array(Math.round(seconds * rate));
  }

  /** A sine with a quick attack and an exponential decay. */
  tone(
    at: number,
    length: number,
    freq: number,
    amp: number,
    { attack = 0.004, decay = length / 4, glide = 0 } = {},
  ) {
    const from = Math.round(at * this.rate);
    const n = Math.round(length * this.rate);
    let phase = 0;
    for (let i = 0; i < n && from + i < this.out.length; i += 1) {
      if (from + i < 0) continue;
      const t = i / this.rate;
      const env = Math.min(1, t / attack) * Math.exp(-t / decay);
      const fade = Math.min(1, (n - i) / (this.rate * 0.01));
      phase += (2 * Math.PI * freq * (1 + (glide * t) / length)) / this.rate;
      this.out[from + i]! += Math.sin(phase) * amp * env * fade;
    }
  }

  /** Low-passed noise, shaped by `env` over its length (0..1). */
  noise(
    at: number,
    length: number,
    amp: number,
    seed: number,
    {
      cutoff = 2000,
      cutoffTo,
      env = (t: number) => 1 - t,
    }: { cutoff?: number; cutoffTo?: number; env?: (t: number) => number } = {},
  ) {
    const to = cutoffTo ?? cutoff;
    const next = random(seed);
    const from = Math.round(at * this.rate);
    const n = Math.round(length * this.rate);
    let low = 0;
    for (let i = 0; i < n && from + i < this.out.length; i += 1) {
      const u = i / n;
      const fc = cutoff + (to - cutoff) * u;
      const k = 1 - Math.exp((-2 * Math.PI * fc) / this.rate);
      low += (next() * 2 - 1 - low) * k;
      if (from + i >= 0) this.out[from + i]! += low * amp * env(u);
    }
  }

  // ------------------------------------------------- the usual accents

  /** A short kick: a pitch-dropping thump with a click on top. */
  kick(at: number, amp = 0.4) {
    this.tone(at, 0.32, 120, amp, { attack: 0.002, decay: 0.08, glide: -0.65 });
    this.noise(at, 0.012, amp * 0.4, Math.round(at * 997), { cutoff: 4000 });
  }

  /** A closed hi-hat tick. */
  hat(at: number, amp = 0.05) {
    this.noise(at, 0.045, amp, Math.round(at * 7919), {
      cutoff: 9000,
      env: (u) => (1 - u) ** 4,
    });
  }

  /** A heavy hit for a result: kick, sub and a burst of air. */
  impact(at: number, amp = 0.5) {
    this.kick(at, amp);
    this.tone(at, 1.1, 46, amp * 0.8, { attack: 0.004, decay: 0.32 });
    this.noise(at, 0.35, amp * 0.35, Math.round(at * 131), {
      cutoff: 2500,
      cutoffTo: 400,
      env: (u) => (1 - u) ** 2,
    });
  }

  /** Noise and a tone rising together into a moment at `at + length`. */
  riser(at: number, length: number, amp = 0.08) {
    this.noise(at, length, amp, Math.round(at * 389), {
      cutoff: 300,
      cutoffTo: 6000,
      env: (u) => u ** 2.2,
    });
    this.tone(at, length, 220, amp * 0.5, {
      attack: length * 0.8,
      decay: length * 4,
      glide: 2,
    });
  }

  /** A tape rewind: falling air with fast rising chirps. */
  rewind(at: number, length: number, amp = 0.12) {
    this.noise(at, length, amp, Math.round(at * 613), {
      cutoff: 7000,
      cutoffTo: 500,
      env: (u) => Math.sin(Math.PI * u) * (0.6 + 0.4 * Math.sin(u * 60)),
    });
    for (let k = 0; k < 5; k += 1) {
      this.tone(at + (k * length) / 5, length / 5, 500 + k * 180, amp * 0.35, {
        decay: 0.03,
        glide: 1.5,
      });
    }
  }

  /** A pitched pluck with two overtones. */
  pluck(at: number, freq: number, amp = 0.1) {
    this.tone(at, 0.7, freq, amp, { decay: 0.18 });
    this.tone(at, 0.5, freq * 2, amp * 0.35, { decay: 0.09 });
    this.tone(at, 0.3, freq * 3, amp * 0.15, { decay: 0.05 });
  }

  /** A chord, its notes rung together. */
  chord(
    at: number,
    freqs: readonly number[],
    amp: number,
    length: number,
    decay = length / 3,
  ) {
    freqs.forEach((freq, i) =>
      this.tone(at, length, freq, amp / (1 + i * 0.35), {
        attack: 0.006,
        decay,
      }),
    );
  }

  /**
   * Brings the mix to a level that suits phones (about -16 LUFS for this
   * material), then rounds off the peaks so none passes `ceiling`.
   */
  finish(rms = 0.15, ceiling = 0.9): Float32Array {
    let sum = 0;
    for (const v of this.out) sum += v * v;
    const gain = rms / Math.sqrt(sum / this.out.length || 1);
    for (let i = 0; i < this.out.length; i += 1) {
      this.out[i] = ceiling * Math.tanh((this.out[i]! * gain) / ceiling);
    }
    return this.out;
  }
}
