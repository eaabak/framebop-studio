/**
 * Microphone recording for "Clone your voice", and playback of recordings
 * and voice samples.
 *
 * Audio is captured as raw samples and saved as a 16-bit WAV, without the
 * browser's echo cancellation, noise suppression or automatic gain: those
 * change the voice, and the engine cleans the recording up itself. There is
 * deliberately no way to load an audio file here.
 */

export interface Recording {
  samples: Float32Array;
  sampleRate: number;
  seconds: number;
}

export interface Levels {
  /** Highest absolute sample, 0 to 1. */
  peak: number;
  /** Root mean square, 0 to 1. */
  rms: number;
  /** Share of samples at or near full scale. */
  clipped: number;
}

export function measure(samples: Float32Array): Levels {
  let peak = 0;
  let sum = 0;
  let clipped = 0;
  for (const sample of samples) {
    const value = Math.abs(sample);
    if (value > peak) peak = value;
    if (value >= 0.998) clipped++;
    sum += sample * sample;
  }
  const count = Math.max(1, samples.length);
  return { peak, rms: Math.sqrt(sum / count), clipped: clipped / count };
}

/** A meter position, 0 to 1, for a level: -60 dBFS to 0 dBFS. */
export function meterPosition(level: number): number {
  if (level <= 0) return 0;
  const db = 20 * Math.log10(level);
  return Math.min(1, Math.max(0, (db + 60) / 60));
}

/** A mono 16-bit PCM WAV file. */
export function encodeWav(
  samples: Float32Array,
  sampleRate: number,
): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(44 + i * 2, Math.round(value * 32767), true);
  }
  return bytes;
}

export function toBase64(bytes: Uint8Array): string {
  let text = "";
  // In slices: spreading megabytes into one call overflows the stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(text);
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export type MicrophoneProblem = "denied" | "missing" | "unsupported" | "failed";

export class MicrophoneError extends Error {
  constructor(readonly problem: MicrophoneProblem) {
    super(problem);
  }
}

/** Records from the default microphone until stopped. */
export class MicRecorder {
  private chunks: Float32Array[] = [];
  private length = 0;

  private constructor(
    private readonly context: AudioContext,
    private readonly stream: MediaStream,
    private readonly processor: ScriptProcessorNode,
    private readonly maxSeconds: number,
    private readonly onLimit: () => void,
  ) {}

  /**
   * Asks for the microphone (the system may ask the user first) and starts
   * recording. `onLevel` receives the peak of every block, about 12 times a
   * second.
   */
  static async start(
    onLevel: (peak: number) => void,
    maxSeconds: number,
    onLimit: () => void,
  ): Promise<MicRecorder> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new MicrophoneError("unsupported");
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      throw new MicrophoneError(
        name === "NotAllowedError" || name === "SecurityError"
          ? "denied"
          : name === "NotFoundError" || name === "OverconstrainedError"
            ? "missing"
            : "failed",
      );
    }
    const context = new AudioContext();
    await context.resume();
    const source = context.createMediaStreamSource(stream);
    // ScriptProcessorNode is deprecated but works in every webview without
    // loading a worklet module, which the content security policy forbids.
    const processor = context.createScriptProcessor(4096, 1, 1);
    const recorder = new MicRecorder(
      context,
      stream,
      processor,
      maxSeconds,
      onLimit,
    );
    processor.onaudioprocess = (event) => {
      const block = new Float32Array(event.inputBuffer.getChannelData(0));
      recorder.chunks.push(block);
      recorder.length += block.length;
      onLevel(measure(block).peak);
      if (recorder.length / context.sampleRate >= maxSeconds) {
        recorder.onLimit();
      }
    };
    // A silent output keeps the processor running.
    const mute = context.createGain();
    mute.gain.value = 0;
    source.connect(processor);
    processor.connect(mute);
    mute.connect(context.destination);
    return recorder;
  }

  get seconds(): number {
    return this.length / this.context.sampleRate;
  }

  stop(): Recording {
    this.release();
    const samples = new Float32Array(
      Math.min(
        this.length,
        Math.round(this.maxSeconds * this.context.sampleRate),
      ),
    );
    let offset = 0;
    for (const chunk of this.chunks) {
      if (offset >= samples.length) break;
      const part = chunk.subarray(0, samples.length - offset);
      samples.set(part, offset);
      offset += part.length;
    }
    this.chunks = [];
    const sampleRate = this.context.sampleRate;
    return { samples, sampleRate, seconds: samples.length / sampleRate };
  }

  cancel(): void {
    this.release();
    this.chunks = [];
  }

  private release(): void {
    this.processor.onaudioprocess = null;
    this.processor.disconnect();
    for (const track of this.stream.getTracks()) track.stop();
    void this.context.close().catch(() => {});
  }
}

/** Plays one sound at a time through Web Audio. */
export class Player {
  private context: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;

  private audio(): AudioContext {
    this.context ??= new AudioContext();
    return this.context;
  }

  async playSamples(recording: Recording, onEnd?: () => void): Promise<void> {
    const context = this.audio();
    const buffer = context.createBuffer(
      1,
      recording.samples.length,
      recording.sampleRate,
    );
    buffer.copyToChannel(recording.samples as Float32Array<ArrayBuffer>, 0);
    await this.play(buffer, onEnd);
  }

  async playWav(wav: Uint8Array, onEnd?: () => void): Promise<void> {
    const context = this.audio();
    const copy = wav.slice().buffer;
    await this.play(await context.decodeAudioData(copy), onEnd);
  }

  private async play(buffer: AudioBuffer, onEnd?: () => void): Promise<void> {
    this.stop();
    const context = this.audio();
    await context.resume();
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.onended = () => {
      if (this.source === source) this.source = null;
      onEnd?.();
    };
    this.source = source;
    source.start();
  }

  stop(): void {
    const source = this.source;
    this.source = null;
    if (source) {
      source.onended = null;
      source.stop();
    }
  }

  close(): void {
    this.stop();
    void this.context?.close().catch(() => {});
    this.context = null;
  }
}
