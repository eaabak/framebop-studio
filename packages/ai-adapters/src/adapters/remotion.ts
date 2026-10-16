/**
 * Renders a plan to MP4 with Remotion, through the render worker of
 * `@framebop/renderer` running as a separate Node.js process.
 *
 * This adapter only starts the worker and relays its messages. The worker,
 * the composition it renders and Remotion itself are located through the
 * environment, so an installed app and a development checkout can keep them
 * in different places.
 */
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
  type AdapterAvailability,
  type AdapterCapabilities,
  AdapterError,
  type ExecutionContext,
  type VideoRenderAdapter,
  type VideoRenderRequest,
  type VideoRenderResult,
} from "../contracts";

export const REMOTION_ID = "remotion";

/** Grace period between asking the worker to stop and ending it. */
const STOP_GRACE_MS = 5000;

export interface RemotionLocation {
  /** The bundled worker script, render-worker.mjs. */
  workerPath: string;
  /** The bundled composition: a folder containing index.html. */
  siteDirectory: string;
  /**
   * The Chrome build to render with. Remotion would download one on its own
   * if none were given; that never happens here, because a render without a
   * browser is refused instead.
   */
  browserExecutable: string | null;
}

export interface RemotionEnvironment {
  /** Node.js to run the worker with: the runtime the engine runs on. */
  nodePath: string;
  locate: () => RemotionLocation | null;
}

const exists = (path: string) =>
  access(path, constants.R_OK).then(
    () => true,
    () => false,
  );

async function isExecutableFile(path: string): Promise<boolean> {
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) return false;
  return access(path, constants.X_OK).then(
    () => true,
    () => false,
  );
}

type WorkerMessage =
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

export class RemotionRenderAdapter implements VideoRenderAdapter {
  readonly id = REMOTION_ID;
  readonly name = "Remotion";
  readonly task = "video_render";
  readonly isTest = false;
  readonly supportedPlatforms = ["macos", "windows", "linux"] as const;

  constructor(private readonly environment: RemotionEnvironment) {}

  async detect(): Promise<AdapterAvailability> {
    const unavailable = (reason: string, installed = false) => ({
      available: false,
      reason,
      version: null,
      location: null,
      installed,
    });
    const location = this.environment.locate();
    if (location === null) {
      return unavailable(
        "This build of Framebop Studio does not include the renderer. For now, rendering works in the development build (pnpm dev).",
      );
    }
    if (!(await exists(location.workerPath))) {
      return unavailable(
        "The render worker has not been built. Run `pnpm build` first.",
      );
    }
    if (!(await exists(join(location.siteDirectory, "index.html")))) {
      return unavailable(
        "The video composition has not been bundled. Run `pnpm build` first.",
      );
    }
    let version: string | null = null;
    try {
      // Resolved the way the worker will resolve it, from its own folder.
      const require = createRequire(location.workerPath);
      const manifest = require("@remotion/renderer/package.json") as {
        version?: string;
      };
      version = manifest.version ?? null;
    } catch {
      return unavailable(
        "Remotion's renderer is not installed next to the render worker.",
      );
    }
    if (!location.browserExecutable) {
      return unavailable(
        "Remotion needs a Chrome build to render. Choose one in Settings → Rendering.",
        true,
      );
    }
    if (!(await isExecutableFile(location.browserExecutable))) {
      return unavailable(
        `The browser chosen for rendering cannot be started: ${location.browserExecutable}`,
        true,
      );
    }
    return {
      available: true,
      reason: null,
      version,
      location: location.workerPath,
      installed: true,
    };
  }

  async getCapabilities(): Promise<AdapterCapabilities> {
    return {
      maturity: "verified",
      models: [],
      requiresModel: false,
      parameters: [],
      resolutions: [
        { width: 1920, height: 1080 },
        { width: 1280, height: 720 },
      ],
      requiresPrompt: false,
      requiresInputImage: false,
      supportsCancellation: true,
      reportsProgress: true,
      expensive: false,
      notes: [
        "Renders in a headless browser in a separate process, one video at a time.",
        "H.264 video and AAC audio in an MP4 file.",
      ],
    };
  }

  async generate(
    request: VideoRenderRequest,
    context: ExecutionContext,
  ): Promise<VideoRenderResult> {
    const location = this.environment.locate();
    if (!location?.browserExecutable) {
      throw new AdapterError(
        "UNAVAILABLE",
        "Remotion is not set up to render.",
      );
    }
    const outputPath = join(context.outputDirectory, "render.mp4");
    context.signal.throwIfAborted();

    const child = spawn(this.environment.nodePath, [location.workerPath], {
      cwd: context.outputDirectory,
      stdio: ["pipe", "pipe", "pipe"],
      // The worker inherits nothing it does not need from the engine.
      env: { ...process.env, NODE_OPTIONS: "" },
      windowsHide: true,
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-4000);
    });
    child.stdin.on("error", () => {});

    let failure: { code: string; message: string } | null = null;
    let done = false;
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      let message: WorkerMessage;
      try {
        message = JSON.parse(line) as WorkerMessage;
      } catch {
        return;
      }
      if (message.type === "progress") {
        const text =
          message.stage === "preparing"
            ? "Starting the renderer"
            : message.stage === "encoding"
              ? "Writing the MP4 file"
              : `Rendered ${message.renderedFrames} of ${message.totalFrames} frames`;
        context.reportProgress({
          fraction: message.fraction,
          message: text,
          // The worker composes the timeline in the browser before drawing.
          stage: message.stage === "preparing" ? "composing" : "rendering",
        });
      } else if (message.type === "done") {
        done = true;
      } else {
        failure = { code: message.code, message: message.message };
      }
    });

    const exited = new Promise<number | null>((resolve) => {
      child.on("exit", (code) => resolve(code));
      child.on("error", (error) => {
        failure = { code: "UNAVAILABLE", message: error.message };
        resolve(null);
      });
    });

    let killTimer: NodeJS.Timeout | undefined;
    const onAbort = () => {
      child.stdin.write(`${JSON.stringify({ command: "cancel" })}\n`);
      // A worker that does not stop in time is ended.
      killTimer = setTimeout(() => child.kill("SIGKILL"), STOP_GRACE_MS);
    };
    context.signal.addEventListener("abort", onAbort, { once: true });

    child.stdin.write(
      `${JSON.stringify({
        command: "render",
        plan: request.plan,
        serveUrl: location.siteDirectory,
        outputPath,
        browserExecutable: location.browserExecutable,
        concurrency: null,
      })}\n`,
    );
    context.log("Render worker started", {
      frames: request.plan.durationInFrames,
      width: request.plan.width,
      height: request.plan.height,
    });

    const exitCode = await exited;
    context.signal.removeEventListener("abort", onAbort);
    clearTimeout(killTimer);
    child.stdin.end();
    lines.close();

    if (context.signal.aborted) {
      throw new AdapterError("CANCELLED", "The render was stopped.");
    }
    const failed = failure as { code: string; message: string } | null;
    if (failed || !done || exitCode !== 0) {
      const detail =
        failed?.message ??
        (stderr.trim().split("\n").slice(-3).join(" | ") ||
          `the worker exited with code ${exitCode}`);
      throw new AdapterError(
        failed?.code === "VALIDATION" ? "INVALID_REQUEST" : "ENGINE_FAILURE",
        `The render failed: ${detail}`,
      );
    }
    return {
      artifact: { path: outputPath, kind: "video" },
      model: null,
      details: { renderer: "remotion" },
    };
  }
}
