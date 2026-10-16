// Runs the interface in a web browser for development: starts the engine with
// its loopback-only HTTP bridge, then starts Vite configured to proxy to it.
//
// This exists because browser tooling (devtools, automation, quick reloads)
// is convenient while working on the interface. It is not how the product
// ships: the desktop app talks to the engine over a private pipe, with no
// network port. See packages/orchestrator/src/transports/dev-http.ts.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// pnpm is a .cmd shim on Windows, which needs a shell to launch.
const shell = process.platform === "win32";

// The engine, and the render worker and composition it starts for exports.
for (const target of ["@framebop/renderer", "@framebop/orchestrator"]) {
  const built = spawnSync("pnpm", ["--filter", target, "build"], {
    cwd: root,
    stdio: "inherit",
    shell,
  });
  if (built.status !== 0) process.exit(built.status ?? 1);
}

const port = Number(process.env.FRAMEBOP_BRIDGE_PORT ?? 4317);
// A fresh secret every run. It is handed to the two child processes through
// their environment and is never written to disk.
const token = randomBytes(32).toString("hex");
// A separate library from the desktop app's, so development never touches
// real projects.
const dataDir = process.env.FRAMEBOP_DATA_DIR ?? resolve(root, ".dev-data");

const engine = spawn(
  process.execPath,
  [
    "--disable-warning=ExperimentalWarning",
    "--enable-source-maps",
    resolve(root, "packages/orchestrator/dist/worker.mjs"),
    "--transport",
    "http",
    "--port",
    String(port),
    "--data-dir",
    dataDir,
  ],
  {
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, FRAMEBOP_BRIDGE_TOKEN: token },
  },
);

const vite = spawn("pnpm", ["--filter", "@framebop/desktop", "dev:ui"], {
  cwd: root,
  stdio: "inherit",
  shell,
  env: {
    ...process.env,
    FRAMEBOP_BRIDGE_URL: `http://127.0.0.1:${port}`,
    FRAMEBOP_BRIDGE_TOKEN: token,
  },
});

let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  engine.kill();
  vite.kill();
  process.exit(code);
}

engine.on("exit", (code) => stop(code ?? 1));
vite.on("exit", (code) => stop(code ?? 0));
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
