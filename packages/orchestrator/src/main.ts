/**
 * Process entry point for the engine.
 *
 *   node worker.mjs --data-dir <absolute path> [--transport stdio|http] [--port <n>]
 *
 * `stdio` is what the desktop shell uses. `http` is the development bridge
 * for running the interface in a browser; it requires a secret in the
 * FRAMEBOP_BRIDGE_TOKEN environment variable (passed through the environment
 * rather than argv so it is not visible in process listings).
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { type Engine, createEngine } from "./engine";
import { serveDevBridge } from "./transports/dev-http";
import { serveStdio } from "./transports/stdio";

/** How long shutdown may take before the process exits regardless. */
const SHUTDOWN_DEADLINE_MS = 3000;

/**
 * Finds the render worker and its composition: given explicitly, or next to
 * this script in an installed app, or in the workspace during development.
 */
function locateRenderer(explicit: string | undefined) {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = explicit
    ? [resolve(explicit)]
    : [join(here, "renderer"), resolve(here, "../../renderer/dist")];
  for (const directory of candidates) {
    const workerPath = join(directory, "render-worker.mjs");
    if (existsSync(workerPath)) {
      return { workerPath, siteDirectory: join(directory, "site") };
    }
  }
  return null;
}

function fail(message: string): never {
  process.stderr.write(`framebop-engine: ${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "data-dir": { type: "string" },
      transport: { type: "string", default: "stdio" },
      port: { type: "string", default: "0" },
      "renderer-dir": { type: "string" },
    },
  });

  const dataDir = values["data-dir"];
  if (!dataDir) fail("--data-dir is required.");
  const transport = values.transport;
  if (transport !== "stdio" && transport !== "http") {
    fail(`Unknown transport "${transport}". Use "stdio" or "http".`);
  }

  if (transport === "stdio") {
    // stdout carries the protocol. Anything that prints must use stderr.
    console.log = console.error;
    console.info = console.error;
  }

  let engine: Engine;
  try {
    engine = await createEngine({
      dataDir,
      mirrorLogsToStderr: true,
      renderer: locateRenderer(values["renderer-dir"]),
      // For development and testing only: a stand-in for huggingface.co.
      huggingFaceEndpoint: process.env.FRAMEBOP_HF_ENDPOINT || undefined,
      // Development only: a stand-in YouTube API and a separate keychain
      // entry, so testing never touches the user's real key.
      youtubeEndpoint: process.env.FRAMEBOP_YOUTUBE_ENDPOINT || undefined,
      secretNamespace: process.env.FRAMEBOP_SECRET_NAMESPACE || undefined,
    });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  // The parent process can disappear at any moment: a crash, a force quit, a
  // power-user `kill`. Its ends of our pipes close with it, and writing to
  // them then fails. Without these handlers that failure is an uncaught
  // exception, and reporting it writes to the same dead pipe again.
  process.stdout.on("error", () => {});
  process.stderr.on("error", () => {});

  let stopping = false;
  let closeTransport: () => Promise<void> = async () => {};
  const stop = async (exitCode: number) => {
    if (stopping) return;
    stopping = true;
    // An engine that outlives its application is invisible to the user and
    // keeps the library open, so cleanup gets a deadline rather than a veto.
    setTimeout(() => process.exit(exitCode), SHUTDOWN_DEADLINE_MS).unref();
    try {
      await closeTransport();
      await engine.close();
    } finally {
      process.exit(exitCode);
    }
  };

  process.once("SIGINT", () => void stop(0));
  process.once("SIGTERM", () => void stop(0));
  process.on("uncaughtException", (error) => {
    // A failure while already shutting down must not restart the shutdown.
    if (stopping) process.exit(1);
    engine.context.log.scope("engine").error("Uncaught exception", {
      reason: error.message,
      stack: error.stack,
    });
    void stop(1);
  });

  if (transport === "stdio") {
    serveStdio(engine, process.stdin, process.stdout, () => void stop(0));
    return;
  }

  const token = process.env.FRAMEBOP_BRIDGE_TOKEN;
  if (!token) fail("FRAMEBOP_BRIDGE_TOKEN must be set for the http transport.");
  const port = Number.parseInt(values.port, 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    fail("Invalid --port.");
  const bridge = await serveDevBridge(engine, { port, token });
  closeTransport = () => bridge.close();
}

void main();
