// Splits one continuous voice-over take into the nine lines the promo places
// on its timeline (public/vo/vo-01.wav … vo-09.wav). It cuts at the longest
// pauses, so record the lines in one take with a clear break between them.
// Usage: node scripts/split-voice.mjs <take.mp3|wav> [lines=9]
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [take, linesArg] = process.argv.slice(2);
if (!take) {
  console.error("Usage: node scripts/split-voice.mjs <take.mp3|wav> [lines=9]");
  process.exit(1);
}
const lines = Number(linesArg ?? 9);
const outDir =
  process.env.PROMO_VO_DIR ??
  join(dirname(fileURLToPath(import.meta.url)), "../public/vo");
mkdirSync(outDir, { recursive: true });

const duration = Number(
  execFileSync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "csv=p=0",
    take,
  ]).toString(),
);

// Pauses: silence of at least 0.25 s, 35 dB under full scale.
const probe = spawnSync(
  "ffmpeg",
  [
    "-hide_banner",
    "-i",
    take,
    "-af",
    "silencedetect=n=-35dB:d=0.25",
    "-f",
    "null",
    "-",
  ],
  {
    encoding: "utf8",
  },
);
const pauses = [];
let leadEnd = 0;
let tailStart = duration;
let start = null;
for (const line of probe.stderr.split("\n")) {
  const s = line.match(/silence_start: ([\d.]+)/);
  const e = line.match(/silence_end: ([\d.]+)/);
  if (s) start = Number(s[1]);
  if (e && start !== null) {
    const end = Number(e[1]);
    if (start <= 0.05) leadEnd = end;
    else if (end >= duration - 0.05) tailStart = start;
    else pauses.push({ start, end, length: end - start });
    start = null;
  }
}
// A take that ends in silence reports no silence_end for it.
if (start !== null && start > 0.05) tailStart = start;
if (pauses.length < lines - 1) {
  console.error(
    `Found ${pauses.length} pauses, need ${lines - 1}. Leave a clearer break between lines.`,
  );
  process.exit(1);
}

// The longest pauses separate the lines; each line runs from the end of one
// to the start of the next, with a breath of room on both sides.
const breaks = pauses
  .sort((a, b) => b.length - a.length)
  .slice(0, lines - 1)
  .sort((a, b) => a.start - b.start);

for (let i = 0; i < lines; i++) {
  const out = join(outDir, `vo-${String(i + 1).padStart(2, "0")}.wav`);
  const from = Math.max(0, (i === 0 ? leadEnd : breaks[i - 1].end) - 0.03);
  const to = Math.min(
    duration,
    (i === lines - 1 ? tailStart : breaks[i].start) + 0.12,
  );
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-i",
    take,
    "-ss",
    from.toFixed(3),
    "-to",
    to.toFixed(3),
    "-af",
    "aformat=sample_rates=48000:channel_layouts=stereo",
    out,
  ]);
  const len = Number(
    execFileSync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      out,
    ]).toString(),
  );
  console.log(`vo-${String(i + 1).padStart(2, "0")}.wav  ${len.toFixed(2)} s`);
}
