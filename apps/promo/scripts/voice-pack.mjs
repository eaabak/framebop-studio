// Reads the voice-over lines with a voice from Framebop's English voice pack,
// using the sherpa-onnx runtime the app installed, the way "Read with AI" and
// Generate → Narration do. Writes public/vo/vo-01.wav … vo-09.wav.
// Usage: node scripts/voice-pack.mjs [voice=af_bella]
// The library is FRAMEBOP_DATA_DIR, or the app's default on macOS.
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LINES } from "./lines.mjs";

// Speaker-id order of Kokoro v0.19, as in VOICE_PACKS
// (packages/orchestrator/src/services/runtimes.ts).
const VOICES = [
  "af",
  "af_bella",
  "af_nicole",
  "af_sarah",
  "af_sky",
  "am_adam",
  "am_michael",
  "bf_emma",
  "bf_isabella",
  "bm_george",
  "bm_lewis",
];

const voice = process.argv[2] ?? "af_bella";
const sid = VOICES.indexOf(voice);
if (sid < 0) {
  console.error(`Unknown voice "${voice}". One of: ${VOICES.join(", ")}`);
  process.exit(1);
}
const library =
  process.env.FRAMEBOP_DATA_DIR ??
  join(homedir(), "Library/Application Support/com.framebop.studio");
const pack = join(library, "voices/en-kokoro");
const runtimes = join(library, "runtimes/sherpa-onnx");
const version = readdirSync(runtimes).sort().at(-1);
const tts = join(runtimes, version, "bin/sherpa-onnx-offline-tts");
const outDir = join(dirname(fileURLToPath(import.meta.url)), "../public/vo");
mkdirSync(outDir, { recursive: true });

LINES.forEach((line, i) => {
  const out = join(outDir, `vo-${String(i + 1).padStart(2, "0")}.wav`);
  execFileSync(
    tts,
    [
      `--kokoro-model=${join(pack, "model.int8.onnx")}`,
      `--kokoro-tokens=${join(pack, "tokens.txt")}`,
      `--kokoro-data-dir=${join(pack, "espeak-ng-data")}`,
      `--kokoro-voices=${join(pack, "voices.bin")}`,
      "--kokoro-length-scale=1",
      `--sid=${sid}`,
      "--num-threads=4",
      `--output-filename=${out}`,
      line,
    ],
    { stdio: "ignore" },
  );
  console.log("voiced", out);
});
