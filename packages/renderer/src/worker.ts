/**
 * The render worker: a separate Node.js process that renders one plan to an
 * MP4 with Remotion, then exits.
 *
 * It runs outside the engine so that bundling, a headless browser and
 * encoding can neither block the engine nor take it down, and so that a
 * render can always be stopped by ending the process.
 *
 * Protocol, one JSON object per line:
 *   stdin   {"command":"render", ...RenderJob}   once, to start
 *           {"command":"cancel"}                 to stop; closing stdin too
 *   stdout  {"type":"progress", ...}             measured progress
 *           {"type":"done"} | {"type":"error", code, message}
 *
 * Remotion is never given a licence key: with one, even "free-license", it
 * reports each render to remotion.pro. Without one it makes no request.
 * It is also always given an existing browser, so it never downloads one.
 */
import { randomBytes } from "node:crypto";
import { createReadStream, statSync } from "node:fs";
import { type Server, createServer } from "node:http";
import { cpus } from "node:os";
import { extname } from "node:path";
import { createInterface } from "node:readline";
import {
  makeCancelSignal,
  renderMedia,
  selectComposition,
} from "@remotion/renderer";
import { type RenderPlan, RenderPlanSchema } from "@framebop/core";
import { z } from "zod";

const COMPOSITION_ID = "FramebopEpisode";

const RenderJobSchema = z.object({
  command: z.literal("render"),
  plan: RenderPlanSchema,
  /** Folder of the bundled composition (contains index.html). */
  serveUrl: z.string(),
  outputPath: z.string(),
  browserExecutable: z.string(),
  concurrency: z.number().int().positive().nullable(),
});

type Message =
  | {
      type: "progress";
      stage: "preparing" | "rendering" | "encoding";
      fraction: number | null;
      renderedFrames: number;
      encodedFrames: number;
      totalFrames: number;
    }
  | { type: "done" }
  | { type: "error"; code: string; message: string };

function send(message: Message): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
};

/**
 * Serves exactly the files the plan uses, on the loopback interface, under a
 * random path. Nothing else on disk can be requested through it.
 */
async function serveMedia(
  plan: RenderPlan,
): Promise<{ plan: RenderPlan; server: Server }> {
  const token = randomBytes(16).toString("hex");
  const files = new Map<string, string>();
  const urlFor = new Map<string, string>();
  let origin = "";

  const server = createServer((request, response) => {
    const path = files.get((request.url ?? "").split("?")[0] ?? "");
    if (!path || (request.method !== "GET" && request.method !== "HEAD")) {
      response.writeHead(404).end();
      return;
    }
    const size = statSync(path).size;
    const type =
      CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? "");
    let start = 0;
    let end = size - 1;
    if (range) {
      start = range[1] ? Number(range[1]) : size - Number(range[2]);
      end = range[1] && range[2] ? Number(range[2]) : size - 1;
      if (start > end || end >= size) {
        response.writeHead(416, { "content-range": `bytes */${size}` }).end();
        return;
      }
    }
    response.writeHead(range ? 206 : 200, {
      "content-type": type,
      "content-length": end - start + 1,
      "accept-ranges": "bytes",
      // The page loading these runs on another local port.
      "access-control-allow-origin": "*",
      ...(range ? { "content-range": `bytes ${start}-${end}/${size}` } : {}),
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(path, { start, end }).pipe(response);
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("The media server did not start.");
  }
  origin = `http://127.0.0.1:${address.port}`;

  const url = (path: string): string => {
    let existing = urlFor.get(path);
    if (!existing) {
      const route = `/${token}/${files.size}${extname(path).toLowerCase()}`;
      files.set(route, path);
      existing = `${origin}${route}`;
      urlFor.set(path, existing);
    }
    return existing;
  };

  return {
    server,
    plan: {
      ...plan,
      scenes: plan.scenes.map((scene) => ({
        ...scene,
        shots: scene.shots.map((shot) => ({
          ...shot,
          visual:
            shot.visual.kind === "none"
              ? shot.visual
              : shot.visual.kind === "animation"
                ? {
                    ...shot.visual,
                    images: Object.fromEntries(
                      Object.entries(shot.visual.images).map(([key, file]) => [
                        key,
                        { ...file, src: url(file.src) },
                      ]),
                    ),
                  }
                : { ...shot.visual, src: url(shot.visual.src) },
        })),
      })),
      audio: plan.audio.map((clip) => ({ ...clip, src: url(clip.src) })),
    },
  };
}

async function render(
  job: z.infer<typeof RenderJobSchema>,
  control: {
    cancelSignal: ReturnType<typeof makeCancelSignal>["cancelSignal"];
    cancelled: () => boolean;
  },
) {
  const { cancelSignal } = control;

  const total = job.plan.durationInFrames;
  send({
    type: "progress",
    stage: "preparing",
    fraction: null,
    renderedFrames: 0,
    encodedFrames: 0,
    totalFrames: total,
  });

  const { plan, server } = await serveMedia(job.plan);
  // PixiJS and the Lab need WebGL. ANGLE gives the headless browser a GPU-backed
  // context; other renders keep Remotion's default.
  const usesWebGl = plan.scenes.some((scene) =>
    scene.shots.some(
      (shot) =>
        shot.visual.kind === "animation" &&
        (shot.visual.spec.renderer === "pixi" ||
          shot.visual.spec.renderer === "lab"),
    ),
  );
  const chromiumOptions = usesWebGl ? { gl: "angle" as const } : {};
  try {
    const inputProps = { plan };
    const composition = await selectComposition({
      serveUrl: job.serveUrl,
      id: COMPOSITION_ID,
      inputProps,
      browserExecutable: job.browserExecutable,
      chromiumOptions,
      logLevel: "error",
    });
    let lastSent = 0;
    await renderMedia({
      composition,
      serveUrl: job.serveUrl,
      inputProps,
      codec: "h264",
      audioCodec: "aac",
      pixelFormat: "yuv420p",
      imageFormat: "jpeg",
      jpegQuality: 90,
      crf: 18,
      // Always an audio track, even for a silent video, so players and
      // editors treat every export the same way.
      enforceAudioTrack: true,
      outputLocation: job.outputPath,
      overwrite: true,
      browserExecutable: job.browserExecutable,
      chromiumOptions,
      // Bounded, so a long render cannot take all of the machine's memory.
      concurrency:
        job.concurrency ??
        Math.max(1, Math.min(4, Math.floor(cpus().length / 2))),
      offthreadVideoCacheSizeInBytes: 512 * 1024 * 1024,
      cancelSignal,
      logLevel: "error",
      onBrowserDownload: () => {
        throw new Error("Refusing to download a browser during a render.");
      },
      onProgress: ({
        renderedFrames,
        encodedFrames,
        progress,
        stitchStage,
      }) => {
        const now = Date.now();
        if (now - lastSent < 250 && progress < 1) return;
        lastSent = now;
        send({
          type: "progress",
          stage: stitchStage === "muxing" ? "encoding" : "rendering",
          fraction: progress,
          renderedFrames,
          encodedFrames,
          totalFrames: total,
        });
      },
    });
    if (control.cancelled()) throw new Error("cancelled");
    send({ type: "done" });
  } finally {
    server.close();
  }
}

async function main() {
  const { cancel, cancelSignal } = makeCancelSignal();
  let cancelled = false;
  const stop = () => {
    if (cancelled) return;
    cancelled = true;
    cancel();
  };
  const lines = createInterface({ input: process.stdin });
  let resolveFirst: (line: string | null) => void = () => {};
  const first = new Promise<string | null>((resolve) => {
    resolveFirst = resolve;
  });
  let received = 0;
  lines.on("line", (line) => {
    received += 1;
    if (received === 1) resolveFirst(line);
    else if (line.includes('"cancel"')) stop();
  });
  // The engine closing its end means it is gone: stop rather than linger.
  lines.on("close", () => {
    resolveFirst(null);
    stop();
  });

  const request = await first;
  if (request === null) process.exit(0);

  let job: z.infer<typeof RenderJobSchema>;
  try {
    job = RenderJobSchema.parse(JSON.parse(request));
  } catch (error) {
    send({
      type: "error",
      code: "VALIDATION",
      message: `The render request is not valid: ${error instanceof Error ? error.message : String(error)}`,
    });
    process.exit(1);
  }
  try {
    await render(job, { cancelSignal, cancelled: () => cancelled });
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stopped = cancelled || /cancel/i.test(message);
    send({
      type: "error",
      code: stopped ? "CANCELLED" : "ENGINE_FAILURE",
      message: stopped ? "The render was stopped." : message,
    });
    process.exit(stopped ? 2 : 1);
  }
}

void main();
