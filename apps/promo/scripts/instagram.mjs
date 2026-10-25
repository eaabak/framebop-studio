// Makes the Instagram carousel: saves real screenshots of the app (frames of
// the recordings in public/rec) to public/shots, then renders the five
// slides of src/Instagram.tsx to out/instagram/slide-1.png … slide-5.png,
// and the story that points to them to out/instagram/story.png.
// The screenshots themselves are copied to out/instagram/screenshots.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";

const here = join(dirname(fileURLToPath(import.meta.url)), "..");

/** A screenshot: a recording and the second to take it at. */
const SHOTS = [
  ["01-idea", "02-script", 5],
  ["02-script", "02-script", 18.5],
  ["03-picture", "04-picture", 37.8],
  ["04-picture", "06-storyboard", 5.5],
  ["05-workspace", "06-storyboard", 9],
  ["06-voice", "05-voice", 16.5],
  ["07-render", "07-export", 10],
  ["08-video", "07-export", 26],
];

const shots = join(here, "public/shots");
const out = join(here, "out/instagram");
mkdirSync(shots, { recursive: true });
mkdirSync(join(out, "screenshots"), { recursive: true });
for (const [name, rec, at] of SHOTS) {
  const png = join(shots, `${name}.png`);
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-ss",
    String(at),
    "-i",
    join(here, "public/rec", `${rec}.mp4`),
    "-frames:v",
    "1",
    png,
  ]);
  copyFileSync(png, join(out, "screenshots", `${name}.png`));
}

const shell = join(
  here,
  "../../packages/renderer/node_modules/.remotion/chrome-headless-shell",
  "mac-arm64/chrome-headless-shell-mac-arm64/chrome-headless-shell",
);
const browserExecutable = existsSync(shell) ? shell : null;
const serveUrl = await bundle({
  entryPoint: join(here, "src/index.ts"),
  publicDir: join(here, "public"),
});
for (let n = 1; n <= 5; n++) {
  const inputProps = { n };
  const composition = await selectComposition({
    serveUrl,
    id: "Instagram",
    inputProps,
    browserExecutable,
  });
  const output = join(out, `slide-${n}.png`);
  await renderStill({
    composition,
    serveUrl,
    inputProps,
    output,
    browserExecutable,
  });
  console.log("Rendered", output);
}
const story = await selectComposition({
  serveUrl,
  id: "InstagramStory",
  browserExecutable,
});
await renderStill({
  composition: story,
  serveUrl,
  output: join(out, "story.png"),
  browserExecutable,
});
console.log("Rendered", join(out, "story.png"));
