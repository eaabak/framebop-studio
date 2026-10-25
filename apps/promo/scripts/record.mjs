// Records the Framebop web interface for the promo: runs the whole flow in a
// fresh project and saves each step as a screencast at 2x, encoded to a
// 30 fps H.264 MP4 in public/rec (stills too). See README.md for the setup:
// `pnpm dev:web` on a demo library, Google Chrome and FFmpeg installed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "../public/rec");
const stillsDir = path.join(here, "../out/stills");
fs.mkdirSync(stillsDir, { recursive: true });

const URL = "http://localhost:1431/";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
fs.mkdirSync(outDir, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// A macOS-style pointer that follows the (otherwise invisible) headless mouse.
const CURSOR = `
(() => {
  const install = () => {
    if (document.getElementById("__fb_cursor")) return;
    const c = document.createElement("div");
    c.id = "__fb_cursor";
    c.innerHTML = '<svg width="30" height="30" viewBox="0 0 24 24"><path d="M4.5 2.5v17.2l4.6-4.3 2.9 6.6 2.7-1.2-2.8-6.4h6.3z" fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: "fixed", left: "0", top: "0", zIndex: "2147483647", pointerEvents: "none",
      transform: "translate(-200px,-200px)", transition: "none", filter: "drop-shadow(0 2px 3px rgba(0,0,0,.45))" });
    const ring = document.createElement("div");
    Object.assign(ring.style, { position: "fixed", left: "0", top: "0", width: "44px", height: "44px", marginLeft: "-22px", marginTop: "-22px",
      borderRadius: "50%", border: "3px solid rgba(254,187,60,.95)", zIndex: "2147483646", pointerEvents: "none", opacity: "0" });
    document.documentElement.append(ring, c);
    let x = -200, y = -200;
    addEventListener("mousemove", (e) => { x = e.clientX; y = e.clientY; c.style.transform = "translate(" + (x - 5) + "px," + (y - 3) + "px)"; }, true);
    addEventListener("mousedown", () => {
      c.animate([{ scale: 1 }, { scale: 0.85 }, { scale: 1 }], { duration: 220 });
      ring.style.transform = "translate(" + x + "px," + y + "px)";
      ring.animate([{ opacity: 0.95, scale: 0.4 }, { opacity: 0, scale: 1.4 }], { duration: 450, easing: "ease-out" });
    }, true);
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", install); else install();
})();`;

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--hide-scrollbars", "--force-color-profile=srgb"],
});
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: "dark",
  locale: "en-US",
});
await ctx.addInitScript(CURSOR);
const page = await ctx.newPage();
page.setDefaultTimeout(60_000);
const cdp = await ctx.newCDPSession(page);

const hold = (ms) => page.waitForTimeout(ms);
let mouse = { x: 720, y: 450 };

async function glide(x, y, ms = 650) {
  const from = { ...mouse };
  const steps = Math.max(12, Math.round(ms / 16));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
    await page.waitForTimeout(16);
  }
  mouse = { x, y };
}

async function clickEl(locator, { pause = 250 } = {}) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error("no box for " + locator);
  await glide(box.x + box.width / 2, box.y + box.height / 2);
  await hold(pause);
  await page.mouse.down();
  await hold(90);
  await page.mouse.up();
}

async function typeInto(locator, text, delay = 32) {
  await clickEl(locator);
  await hold(200);
  await page.keyboard.press("Meta+A");
  await page.keyboard.type(text, { delay });
}

// ---------- Screencast ----------

let rec = null;
async function startRec(name) {
  const dir = path.join(os.tmpdir(), "framebop-promo-frames", name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const frames = [];
  const onFrame = ({ data, metadata, sessionId }) => {
    const file = path.join(
      dir,
      String(frames.length).padStart(6, "0") + ".jpg",
    );
    fs.writeFileSync(file, Buffer.from(data, "base64"));
    frames.push({ file, t: metadata.timestamp ?? Date.now() / 1000 });
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  };
  cdp.on("Page.screencastFrame", onFrame);
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 92,
    maxWidth: 2880,
    maxHeight: 1800,
    everyNthFrame: 1,
  });
  // Nudge a first frame even if nothing changes.
  await page.mouse.move(mouse.x + 1, mouse.y);
  await page.mouse.move(mouse.x, mouse.y);
  rec = { name, dir, frames, onFrame };
  log("rec start", name);
}

async function stopRec() {
  const stopT = Date.now() / 1000;
  await cdp.send("Page.stopScreencast");
  cdp.off("Page.screencastFrame", rec.onFrame);
  const { frames, dir, name } = rec;
  rec = null;
  if (frames.length === 0) throw new Error("no frames for " + name);
  const epoch = frames[0].t > 1e9;
  const lines = ["ffconcat version 1.0"];
  frames.forEach((f, i) => {
    const next =
      i + 1 < frames.length ? frames[i + 1].t : epoch ? stopT : f.t + 1;
    lines.push(
      `file '${path.basename(f.file)}'`,
      `duration ${Math.max(0.005, next - f.t).toFixed(4)}`,
    );
  });
  lines.push(`file '${path.basename(frames.at(-1).file)}'`);
  fs.writeFileSync(path.join(dir, "list.txt"), lines.join("\n"));
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    path.join(dir, "list.txt"),
    "-vf",
    "fps=30,scale=2880:1800:flags=lanczos,format=yuv420p",
    "-c:v",
    "libx264",
    "-crf",
    "15",
    "-preset",
    "slow",
    "-movflags",
    "+faststart",
    path.join(outDir, name + ".mp4"),
  ]);
  log("rec done", name, frames.length, "frames");
}

async function still(name) {
  await page.screenshot({ path: path.join(stillsDir, name + ".png") });
  log("still", name);
}

// ---------- Helpers for this app ----------

const button = (name, exact = true) =>
  page.getByRole("button", { name, exact });
const nav = (name) =>
  page
    .getByRole("button", {
      name: name === "Export" ? /^(Export|Video)$/ : name,
      exact: name !== "Export",
    })
    .first();

async function selectScene(n) {
  const label = String(n).padStart(2, "0");
  const handle = await page.evaluateHandle((label) => {
    const leaf = [...document.querySelectorAll("main *")].find(
      (e) => e.children.length === 0 && e.textContent.trim() === label,
    );
    return leaf?.closest("button,[role=button],li,[tabindex]") ?? null;
  }, label);
  const el = handle.asElement();
  if (!el) throw new Error("scene card " + label + " not found");
  const box = await el.boundingBox();
  await glide(box.x + box.width / 2, box.y + box.height / 2);
  await hold(200);
  await page.mouse.down();
  await hold(80);
  await page.mouse.up();
}

const PROMPTS = [
  "A tall lighthouse on a rocky cliff at night in a raging storm, huge waves, warm beam of light, painterly storybook illustration",
  "A small wooden fishing boat lost in a stormy sea at night, crew with lanterns, a distant lighthouse beam through the rain, painterly storybook illustration",
  "A small fishing boat safely arriving in a calm harbor at dawn after a storm, lighthouse on the cliff, warm golden light, painterly storybook illustration",
  "An old lighthouse keeper smiling at a window at sunrise, warm light, painterly storybook illustration",
  "A lighthouse beam sweeping over a calm sea under the stars, painterly storybook illustration",
];

async function makeScene(n, record) {
  if (n > 1) await selectScene(n);
  await hold(500);
  if (record) await startRec(record.picture);
  await typeInto(
    page.getByPlaceholder(/What should we see/),
    PROMPTS[(n - 1) % PROMPTS.length],
    record ? 22 : 0,
  );
  await clickEl(button("Make with AI"));
  await button("Make again").waitFor({ timeout: 240_000 });
  await hold(record ? 2500 : 300);
  if (record) {
    await stopRec();
    await startRec(record.voice);
    await hold(500);
  }
  await clickEl(button("Read with AI"));
  await button("Read again").waitFor({ timeout: 180_000 });
  await hold(record ? 2200 : 300);
  if (record) await stopRec();
}

// ---------- The flow ----------

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.getByText("Start your first production").waitFor();
  await hold(800);
  await still("00-empty");

  // 1. A new project.
  await startRec("01-new-project");
  await hold(700);
  await clickEl(button("New project").last());
  await hold(400);
  await typeInto(
    page.getByPlaceholder("Ancient Rome"),
    "The Lighthouse Keeper",
    45,
  );
  await typeInto(
    page.getByPlaceholder("Painterly, warm light, 2D animation"),
    "Painterly, warm light, storybook",
    30,
  );
  const target = page.getByRole("dialog").getByLabel("Target length (minutes)");
  await clickEl(target);
  await target.fill("1");
  await hold(300);
  await clickEl(button("Create project"));
  await hold(1600);
  await stopRec();

  // Unrecorded: open it and add an episode.
  await page.getByRole("heading", { name: "The Lighthouse Keeper" }).click();
  await hold(500);
  await button("New episode").last().click();
  await page
    .getByRole("dialog")
    .getByRole("textbox")
    .fill("Episode 1: The Storm");
  await button("Create episode").click();
  await hold(800);

  // 2. Script with AI.
  await nav("Script").click();
  await hold(900);
  await startRec("02-script");
  await hold(700);
  await typeInto(
    page.getByPlaceholder(/What is the video about/),
    "A lighthouse keeper on a stormy night guides a lost little boat safely home.",
    30,
  );
  await clickEl(button("Write the script"));
  await button("Use it").waitFor({ timeout: 240_000 });
  await hold(1800);
  await clickEl(button("Use it"));
  await hold(2200);
  await stopRec();
  await still("02-script");

  // 3. Scenes from the script.
  await startRec("03-scenes");
  await hold(600);
  await clickEl(button("Create scenes"));
  await hold(2800);
  await stopRec();

  // 4–5. Picture and voice for scene 1 (recorded), then the rest.
  await makeScene(1, { picture: "04-picture", voice: "05-voice" });
  const count = await page.evaluate(() => {
    const m = document
      .querySelector("main")
      ?.innerText.match(/SCENE \d+ \/ (\d+)/i);
    return m ? Number(m[1]) : 3;
  });
  log("scenes", count);
  for (let n = 2; n <= count; n++) await makeScene(n, null);
  await selectScene(1);
  await hold(1200);
  await still("06-scenes");

  // 6. A walk through the storyboard.
  await startRec("06-storyboard");
  await hold(800);
  for (let n = 1; n <= Math.min(count, 4); n++) {
    await selectScene(n);
    await hold(1400);
  }
  await stopRec();

  // 7. The finished video.
  await nav("Export").click();
  await hold(1000);
  await startRec("07-export");
  await hold(800);
  await clickEl(button("Make the video").last());
  await page.getByText("Your video is ready.").waitFor({ timeout: 400_000 });
  await hold(2500);
  await stopRec();
  await still("07-export");
  log("all done");
} catch (error) {
  console.error("FAILED:", error?.message || error);
  try {
    await page.screenshot({ path: path.join(stillsDir, "failure.png") });
  } catch {}
  if (rec) {
    try {
      await stopRec();
    } catch {}
  }
  process.exitCode = 1;
} finally {
  await browser.close();
}
