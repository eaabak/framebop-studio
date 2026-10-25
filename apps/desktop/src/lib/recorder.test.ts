import { describe, expect, it } from "vitest";
import {
  encodeWav,
  fromBase64,
  measure,
  meterPosition,
  toBase64,
} from "./recorder";

describe("recorder helpers", () => {
  it("encodes a mono 16-bit WAV", () => {
    const wav = encodeWav(new Float32Array([0, 0.5, -1, 2]), 48000);
    const view = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...wav.subarray(8, 16))).toBe("WAVEfmt ");
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(8);
    expect([0, 1, 2, 3].map((i) => view.getInt16(44 + i * 2, true))).toEqual([
      0, 16384, -32767, 32767,
    ]);
  });

  it("round-trips large buffers through base64", () => {
    const bytes = new Uint8Array(200_000).map((_, i) => (i * 7) % 256);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });

  it("measures levels and places them on the meter", () => {
    const levels = measure(new Float32Array([0.5, -0.5, 1, 0]));
    expect(levels.peak).toBe(1);
    expect(levels.clipped).toBe(0.25);
    expect(levels.rms).toBeCloseTo(Math.sqrt(1.5 / 4));
    expect(meterPosition(0)).toBe(0);
    expect(meterPosition(1)).toBe(1);
    expect(meterPosition(0.001)).toBeCloseTo(0);
    expect(meterPosition(0.1)).toBeCloseTo(2 / 3);
  });
});
