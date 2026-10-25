/** Framebop's colours and type for motion graphics, and the safe areas. */
export const COLORS = {
  background: "#0B0D12",
  primary: "#FF7A1F",
  secondary: "#14D9CF",
  text: "#F5F7FA",
  dim: "#8A93A6",
  panel: "#121722",
} as const;

/** Inter, as in the app, with system fallbacks. */
export const FONT =
  "'Inter Variable', Inter, system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif";

/**
 * Where text stays clear of the Shorts, Reels and TikTok interface on a
 * 1080 × 1920 picture: their top bar, side buttons and captions.
 */
export const SAFE = { top: 200, bottom: 1540, left: 70, right: 960 } as const;

function channels(color: string): [number, number, number] {
  const rgb = /^rgb\((\d+),(\d+),(\d+)\)$/.exec(color);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const n = Number.parseInt(color.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mixes a colour towards another: 0 keeps it, 1 is the other. */
export function mix(a: string, b: string, t: number): string {
  const x = channels(a);
  const y = channels(b);
  const k = Math.max(0, Math.min(1, t));
  const c = x.map((v, i) => Math.round(v + (y[i]! - v) * k));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
