/**
 * How open a speaking mouth is, frame by frame, from the loudness of the
 * voice. Measured once from the narration file when the plan is made.
 */

/**
 * Mouth openness per frame (0..1) from mono samples in [-1, 1]. Loudness is
 * judged against the voice's own loud parts, so a quiet recording still
 * moves the mouth; the mouth opens at once and closes over a few frames.
 */
export function speechEnvelope(
  samples: Float32Array,
  sampleRate: number,
  fps: number,
): number[] {
  const perFrame = sampleRate / fps;
  const frames = Math.ceil(samples.length / perFrame);
  const rms = new Float64Array(frames);
  for (let f = 0; f < frames; f += 1) {
    const start = Math.floor(f * perFrame);
    const end = Math.min(samples.length, Math.floor((f + 1) * perFrame));
    let sum = 0;
    for (let i = start; i < end; i += 1) sum += samples[i]! * samples[i]!;
    rms[f] = end > start ? Math.sqrt(sum / (end - start)) : 0;
  }
  const voiced = [...rms].filter((value) => value > 1e-4).sort((a, b) => a - b);
  const loud = voiced[Math.floor(0.9 * (voiced.length - 1))] ?? 0;
  if (loud <= 1e-4) return new Array<number>(frames).fill(0);
  const envelope: number[] = [];
  let level = 0;
  for (const value of rms) {
    const db = 20 * Math.log10(Math.max(value, 1e-6) / loud);
    const target = Math.min(1, Math.max(0, (db + 28) / 24));
    level = target > level ? target : level * 0.5 + target * 0.5;
    envelope.push(Math.round(level * 100) / 100);
  }
  return envelope;
}

/** Mono samples in [-1, 1] from signed 16-bit little-endian PCM. */
export function samplesFromPcm16(pcm: Uint8Array): Float32Array {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const samples = new Float32Array(Math.floor(pcm.byteLength / 2));
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = view.getInt16(i * 2, true) / 32768;
  }
  return samples;
}
