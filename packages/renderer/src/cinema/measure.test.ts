import { afterAll, describe, expect, it } from "vitest";
import { measure } from "./measure";

// A browser stand-in: the canvas measures a wide fallback until the font
// has loaded, then the font itself.
let loaded = false;
const doc = {
  fonts: { check: () => loaded },
  createElement: () => ({
    getContext: () => ({
      font: "",
      measureText: (text: string) => ({
        width: text.length * (loaded ? 10 : 14),
      }),
    }),
  }),
};
(globalThis as { document?: unknown }).document = doc;
afterAll(() => {
  delete (globalThis as { document?: unknown }).document;
});

describe("measure", () => {
  it("never keeps widths measured before the font has loaded", () => {
    const early = measure("SHADOW", 100);
    expect(early).not.toBe(6 * 14);
    loaded = true;
    // The same text, once the font is there: the font's own width.
    expect(measure("SHADOW", 100)).toBe(60);
  });
});
