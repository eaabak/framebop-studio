// Renders the promo to out/framebop-promo.mp4 (or the composition named on
// the command line: PromoVertical → out/framebop-promo-vertical.mp4). Uses the renderer package's Chrome Headless Shell when
// it is already there, so nothing is downloaded twice.
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

const here = dirname(fileURLToPath(import.meta.url));
const id = process.argv[2] ?? "Promo";
const shell = join(
  here,
  "../../packages/renderer/node_modules/.remotion/chrome-headless-shell",
  "mac-arm64/chrome-headless-shell-mac-arm64/chrome-headless-shell",
);

const serveUrl = await bundle({
  entryPoint: join(here, "src/index.ts"),
  publicDir: join(here, "public"),
});
const browserExecutable = existsSync(shell) ? shell : null;
const composition = await selectComposition({
  serveUrl,
  id,
  browserExecutable,
  timeoutInMilliseconds: 120_000,
});
mkdirSync(join(here, "out"), { recursive: true });
const name = id.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
const outputLocation = join(here, "out", `framebop-${name}.mp4`);

let last = -1;
await renderMedia({
  composition,
  serveUrl,
  codec: "h264",
  crf: 16,
  audioCodec: "aac",
  outputLocation,
  browserExecutable,
  timeoutInMilliseconds: 120_000,
  // Fewer parallel tabs keep Remotion's video frame extraction stable here.
  concurrency: Number(process.env.PROMO_CONCURRENCY ?? 4),
  onProgress: ({ progress }) => {
    const pct = Math.floor(progress * 10) * 10;
    if (pct !== last) {
      last = pct;
      console.log(`${pct}%`);
    }
  },
});
console.log(`Rendered ${outputLocation}`);
