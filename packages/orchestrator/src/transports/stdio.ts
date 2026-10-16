import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import type {
  ErrorShape,
  RpcEventFrame,
  RpcRequestFrame,
  RpcResponseFrame,
} from "@framebop/core";
import type { Engine } from "../engine";

function isRequest(value: unknown): value is RpcRequestFrame {
  if (typeof value !== "object" || value === null) return false;
  const frame = value as Record<string, unknown>;
  return typeof frame.id === "number" && typeof frame.method === "string";
}

function isShutdown(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).control === "shutdown"
  );
}

/**
 * Serves the engine over a pair of streams using one JSON object per line.
 *
 * This is the production transport: the desktop shell spawns the engine as a
 * child process and talks to it over stdin/stdout, so no network port is ever
 * opened. `onDisconnect` fires when the peer asks for shutdown or closes its
 * end, which is how the engine avoids outliving the application.
 */
export function serveStdio(
  engine: Engine,
  input: Readable,
  output: Writable,
  onDisconnect: () => void,
): void {
  const send = (frame: RpcResponseFrame | RpcEventFrame) => {
    output.write(`${JSON.stringify(frame)}\n`);
  };

  engine.subscribe((event) => send({ event }));

  const inFlight = new Set<Promise<void>>();
  const lines = createInterface({ input, crlfDelay: Infinity });
  lines.on("line", (line) => {
    if (line.trim().length === 0) return;
    let frame: unknown;
    try {
      frame = JSON.parse(line);
    } catch {
      engine.context.log
        .scope("stdio")
        .warn("Ignored a line that is not valid JSON");
      return;
    }
    if (isShutdown(frame)) {
      lines.close();
      return;
    }
    if (!isRequest(frame)) {
      engine.context.log
        .scope("stdio")
        .warn("Ignored a malformed request frame");
      return;
    }
    const { id, method, params } = frame;
    const settled = engine.dispatch(method, params).then(
      (result) => send({ id, ok: true, result }),
      (error: ErrorShape) => send({ id, ok: false, error }),
    );
    inFlight.add(settled);
    void settled.finally(() => inFlight.delete(settled));
  });
  // Let requests that are already running answer before the engine stops, so
  // a save issued just before quitting is not lost.
  lines.once("close", () => {
    void Promise.allSettled([...inFlight]).then(onDisconnect);
  });
}
